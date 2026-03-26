/**
 * Converts Notion API blocks array → HTML string
 *
 * Features:
 * - Renders common blocks cleanly (paragraph, headings, lists, to-do, quote, code, divider)
 * - Renders toggle as <details><summary> element
 * - Renders callout as div with emoji
 * - Renders child_page / link_to_page with title + page_id
 * - Renders media blocks (image, video, audio, file, bookmark, pdf, embed) as HTML elements
 * - Renders equation blocks (block-level and inline)
 * - Generates table_of_contents from heading blocks
 * - Optionally fetches child blocks from Notion API (requires auth)
 * - Supports parseChildPages / separateChildPage config for child page handling
 * - Rate-limited API calls (~3 requests/second)
 * - Unsupported / exotic blocks → full unmodified raw block object in unsupportedHtmlBlocks
 * - Supports column_list + column layout using <div class="notion-row"> and <div class="notion-column">
 * - Supports tab blocks using <div class="notion-tabs"> and <div class="notion-tab"> with tab titles
 * - Supports meeting_notes blocks with Summary, Notes, and Transcript sections
 * - Supports synced_block (original and reference) by rendering children transparently
 * - Supports child_database with title and database_id
 * - Supports link_preview as clickable URL
 * - Supports template blocks (deprecated) by rendering rich_text + children
 * - Supports transcription as alias for meeting_notes
 * - Renders inline mentions: @date (with ⏰ for reminders), @user (with user_id), 📄 page link, 🗄️ database link, 🔗 link_preview, 🌐 link_mention (with title, description, thumbnail)
 * - Accepts block ID string as input (fetches blocks from Notion API)
 * - Configurable pagination: pageSize, startCursor, canPaginate, pageLimit
 *
 * @param {Array|string}  blocks - Notion API blocks array OR a block ID string (requires auth)
 * @param {Object} config - Optional configuration object
 * @param {boolean}        config.parseChildPages   - Fetch and process child page blocks (default: false)
 * @param {boolean}        config.separateChildPage - Return child pages separately instead of inlined (default: false)
 * @param {string|boolean} config.auth              - Notion auth: string = API key, true = no auth header (backend proxy), false/undefined = no API calls
 * @param {number}         config.pageSize          - API page size for top-level fetch (default: 100, max: 100)
 * @param {string}         config.startCursor       - Cursor to resume pagination from
 * @param {boolean}        config.canPaginate       - true = fetch only 1 page (returns next_cursor/has_more); false = fetch all (default: false)
 * @param {number}         config.pageLimit         - Max pages to fetch when canPaginate is false (optional)
 * @param {string[]}       config.outputResponse    - Output format array: ["html"], ["blocks"], or both (default: ["html"])
 */

const NOTION_VERSION = "2026-03-11";

const axios = require("axios");

// ── Rate limiter ─────────────────────────────────────────────────────────────
let _lastApiCallTime = 0;
const MIN_API_INTERVAL_MS = 334; // ~3 requests per second

async function _rateLimitedRequest(config) {
    const now = Date.now();
    const elapsed = now - _lastApiCallTime;
    if (elapsed < MIN_API_INTERVAL_MS) {
        await new Promise(resolve => setTimeout(resolve, MIN_API_INTERVAL_MS - elapsed));
    }
    _lastApiCallTime = Date.now();
    return axios(config);
}

// ── Fetch all children of a block (handles pagination) ───────────────────────
async function fetchBlockChildren(blockId, headers) {
    const allChildren = [];
    let cursor = undefined;
    let hasMore = true;

    while (hasMore) {
        const params = {};
        if (cursor) params.start_cursor = cursor;

        const response = await _rateLimitedRequest({
            method: "GET",
            url: `https://api.notion.com/v1/blocks/${blockId}/children`,
            headers: headers,
            params: params
        });

        const data = response.data;
        if (Array.isArray(data.results)) {
            allChildren.push(...data.results);
        }

        hasMore = data.has_more === true;
        cursor = data.next_cursor || undefined;
    }

    return allChildren;
}

// ── Fetch top-level blocks with configurable pagination ──────────────────────
async function fetchTopLevelBlocks(blockId, headers, opts = {}) {
    const { pageSize = 100, startCursor, canPaginate = false, pageLimit } = opts;
    const allResults = [];
    
    const actualPageSize = canPaginate ? pageSize : 100;
    let cursor = canPaginate ? startCursor : undefined;
    
    let hasMore = true;
    let pagesFetched = 0;

    while (hasMore) {
        const params = { page_size: actualPageSize };
        if (cursor) params.start_cursor = cursor;

        const response = await _rateLimitedRequest({
            method: "GET",
            url: `https://api.notion.com/v1/blocks/${blockId}/children`,
            headers: headers,
            params: params
        });

        const data = response.data;
        if (Array.isArray(data.results)) {
            allResults.push(...data.results);
        }

        hasMore = data.has_more === true;
        cursor = data.next_cursor || undefined;
        pagesFetched++;

        // canPaginate: true → stop after 1 page
        if (canPaginate) break;
        // pageLimit → stop after N pages (only when canPaginate is false)
        if (pageLimit && pagesFetched >= pageLimit) break;
    }

    return {
        results: allResults,
        next_cursor: cursor || null,
        has_more: hasMore
    };
}

// ── Fetch parent page/database/data_source recursively to build breadcrumb ───────────────
async function fetchBreadcrumbs(block, headers) {
    if (!headers) return "🏠 Breadcrumb";

    const path = [];
    let currentParent = block.parent;

    while (currentParent && currentParent.type !== "workspace") {
        try {
            if (currentParent.type === "page_id") {
                const res = await _rateLimitedRequest({
                    method: "GET",
                    url: `https://api.notion.com/v1/pages/${currentParent.page_id}`,
                    headers: headers
                });
                const page = res.data;
                let title = "Untitled";
                if (page.properties) {
                    const titleProp = Object.values(page.properties).find(p => p.type === "title" || p.id === "title");
                    if (titleProp && titleProp.title && titleProp.title.length > 0) {
                        title = titleProp.title.map(t => t.plain_text).join("");
                    }
                }
                if (page.icon && page.icon.type === "emoji") {
                    title = `${page.icon.emoji} ${title}`;
                }
                path.unshift(title);
                currentParent = page.parent;
            } else if (currentParent.type === "database_id") {
                const res = await _rateLimitedRequest({
                    method: "GET",
                    url: `https://api.notion.com/v1/databases/${currentParent.database_id}`,
                    headers: headers
                });
                const database = res.data;
                let title = "Untitled";
                if (database.title && database.title.length > 0) {
                    title = database.title.map(t => t.plain_text).join("");
                }
                if (database.icon && database.icon.type === "emoji") {
                    title = `${database.icon.emoji} ${title}`;
                }
                path.unshift(title);
                currentParent = database.parent;
            } else if (currentParent.type === "data_source_id") {
                const res = await _rateLimitedRequest({
                    method: "GET",
                    url: `https://api.notion.com/v1/data_sources/${currentParent.data_source_id}`,
                    headers: headers
                });
                const dataSource = res.data;
                let title = "Untitled";
                if (dataSource.title && dataSource.title.length > 0) {
                    title = dataSource.title.map(t => t.plain_text).join("");
                }
                if (dataSource.icon && dataSource.icon.type === "emoji") {
                    title = `${dataSource.icon.emoji} ${title}`;
                }
                path.unshift(title);
                currentParent = dataSource.parent;
            } else if (currentParent.type === "block_id") {
                const res = await _rateLimitedRequest({
                    method: "GET",
                    url: `https://api.notion.com/v1/blocks/${currentParent.block_id}`,
                    headers: headers
                });
                const b = res.data;
                currentParent = b.parent;
            } else {
                break;
            }
        } catch (err) {
            console.error(`[notionToHtml] Failed to fetch breadcrumb parent:`, err.message || err);
            break;
        }
    }

    return path.length > 0 ? path : ["🏠 Breadcrumb"];
}

// ── Escape HTML special characters ───────────────────────────────────────────
function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// ── Build Notion API headers based on auth config ────────────────────────────
function _buildHeaders(auth) {
    const headers = {
        "Notion-Version": NOTION_VERSION
    };
    if (typeof auth === "string") {
        headers["Authorization"] = `Bearer ${auth}`;
    }
    // If auth === true, only Notion-Version is sent (backend proxies auth)
    return headers;
}

// ── Main converter ───────────────────────────────────────────────────────────
async function notionToHtml(blocks, config = {}) {
    const {
        parseChildPages = false,
        separateChildPage = false,
        auth = undefined,
        pageSize = 100,
        startCursor = undefined,
        canPaginate = false,
        pageLimit = undefined,
        outputResponse = ["html"]
    } = config;

    const unsupportedHtmlBlocks = [];
    const childPages = [];
    const canFetch = auth === true || typeof auth === "string";
    const headers = canFetch ? _buildHeaders(auth) : null;
    let paginationMeta = null;

    // ── Handle block ID string input ─────────────────────────────────────────
    if (typeof blocks === "string") {
        if (!canFetch) {
            return {
                htmlContent: "",
                unsupportedHtmlBlocks: [{ error: "auth is required when blocks is a block ID" }]
            };
        }
        try {
            const fetched = await fetchTopLevelBlocks(blocks, headers, {
                pageSize, startCursor, canPaginate, pageLimit
            });
            blocks = fetched.results;
            paginationMeta = { next_cursor: fetched.next_cursor, has_more: fetched.has_more };
        } catch (err) {
            return {
                htmlContent: "",
                unsupportedHtmlBlocks: [{ error: `Failed to fetch blocks: ${err.message || err}` }]
            };
        }
    }

    if (!Array.isArray(blocks)) {
        return {
            htmlContent: "",
            unsupportedHtmlBlocks: [{ error: "Input is not an array of blocks or block ID" }]
        };
    }

    // ── Parse rich_text (official Notion API format) → HTML ───────────────────
    function parseRichText(richTextArray = []) {
        if (!Array.isArray(richTextArray) || richTextArray.length === 0) return "";

        return richTextArray.map(item => {
            let text = item.plain_text || "";

            if (!text) return "";

            // Inline equation
            if (item.type === "equation") {
                return `<span class="notion-equation">${escapeHtml(text)}</span>`;
            }

            // ── Mention handling ──────────────────────────────────────────────
            if (item.type === "mention" && item.mention) {
                const mention = item.mention;

                switch (mention.type) {
                    case "date": {
                        const dateObj = mention.date || {};
                        const start = dateObj.start || "";
                        const end = dateObj.end || "";
                        const isReminder = start.includes("T");
                        let dateStr = `@${start}`;
                        if (end) dateStr += ` → ${end}`;
                        if (isReminder) dateStr += " ⏰";
                        return `<span class="notion-mention notion-date">${escapeHtml(dateStr)}</span>`;
                    }
                    case "user": {
                        const user = mention.user || {};
                        const userName = user.name || text;
                        const userId = user.id || "";
                        const display = userId
                            ? `@${userName} (user_id: ${userId})`
                            : `@${userName}`;
                        return `<span class="notion-mention notion-user">${escapeHtml(display)}</span>`;
                    }
                    case "page": {
                        const pageId = mention.page?.id || "";
                        const pageTitle = text || "Untitled";
                        const pageHref = item.href || (pageId ? `https://www.notion.so/${pageId.replace(/-/g, "")}` : "");
                        return pageHref
                            ? `<a class="notion-mention notion-page" href="${escapeHtml(pageHref)}">📄 ${escapeHtml(pageTitle)}</a>`
                            : `<span class="notion-mention notion-page">📄 ${escapeHtml(pageTitle)} (page_id: ${escapeHtml(pageId)})</span>`;
                    }
                    case "database": {
                        const dbId = mention.database?.id || "";
                        const dbTitle = text || "Untitled database";
                        const dbHref = item.href || (dbId ? `https://www.notion.so/${dbId.replace(/-/g, "")}` : "");
                        return dbHref
                            ? `<a class="notion-mention notion-database" href="${escapeHtml(dbHref)}">🗄️ ${escapeHtml(dbTitle)}</a>`
                            : `<span class="notion-mention notion-database">🗄️ ${escapeHtml(dbTitle)} (database_id: ${escapeHtml(dbId)})</span>`;
                    }
                    case "link_mention": {
                        const lm = mention.link_mention || {};
                        const lmHref = lm.href || item.href || "";
                        const lmTitle = lm.title || "";
                        const lmDesc = lm.description || "";
                        const lmThumb = lm.thumbnail_url || "";
                        const lmIcon = lm.icon_url || "";

                        let parts = [];
                        if (lmThumb) parts.push(`<img class="notion-link-thumbnail" src="${escapeHtml(lmThumb)}" alt="${escapeHtml(lmTitle || "thumbnail")}">`);
                        const displayTitle = lmTitle || lmHref;
                        if (lmHref) {
                            parts.push(`<a class="notion-mention notion-link-mention" href="${escapeHtml(lmHref)}">🌐 ${escapeHtml(displayTitle)}</a>`);
                        } else {
                            parts.push(`<span class="notion-mention notion-link-mention">🌐 ${escapeHtml(displayTitle)}</span>`);
                        }
                        if (lmDesc) parts.push(`<span class="notion-link-description">${escapeHtml(lmDesc)}</span>`);
                        if (lmIcon) parts.push(`<img class="notion-link-icon" src="${escapeHtml(lmIcon)}" alt="icon">`);

                        return parts.join(" ");
                    }
                    case "link_preview": {
                        const previewUrl = mention.link_preview?.url || item.href || "";
                        return previewUrl
                            ? `<a class="notion-mention notion-link-preview" href="${escapeHtml(previewUrl)}">🔗 ${escapeHtml(text)}</a>`
                            : escapeHtml(text);
                    }
                    default:
                        break;
                }
            }

            text = escapeHtml(text);
            const ann = item.annotations || {};

            if (ann.code) text = `<code>${text}</code>`;
            if (ann.bold) text = `<strong>${text}</strong>`;
            if (ann.italic) text = `<em>${text}</em>`;
            if (ann.strikethrough) text = `<s>${text}</s>`;
            if (ann.underline) text = `<u>${text}</u>`;

            if (ann.color && ann.color !== "default") {
                const isBackground = ann.color.endsWith("_background");
                const colorName = isBackground ? ann.color.replace("_background", "") : ann.color;
                const styleProp = isBackground ? "background-color" : "color";
                text = `<span style="${styleProp}: ${colorName}">${text}</span>`;
            }

            if (item.href) {
                text = `<a href="${escapeHtml(item.href)}">${text}</a>`;
            }

            return text;
        }).join("");
    }

    // ── Generate Table of Contents from heading blocks ────────────────────────
    function generateToc(allBlocks) {
        const headings = [];

        for (const b of allBlocks) {
            if (b.type === "heading_1" || b.type === "heading_2" || b.type === "heading_3") {
                const headingData = b[b.type] || {};
                let headingText = parseRichText(headingData.rich_text || []);
                let plainText = (headingData.rich_text || []).map(r => r.plain_text || "").join("").trim();
                if (!plainText) continue;

                const level = parseInt(b.type.split("_")[1]);
                const anchor = plainText.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
                headings.push({ text: headingText, level, anchor });
            }
        }

        if (headings.length === 0) return "";

        let html = `<nav class="notion-toc">\n<ul>\n`;
        for (const h of headings) {
            const indent = "  ".repeat(h.level);
            html += `${indent}<li class="notion-toc-level-${h.level}"><a href="#${h.anchor}">${h.text}</a></li>\n`;
        }
        html += `</ul>\n</nav>\n`;

        return html;
    }

    // ── Core converter (async for API fetching) ──────────────────────────────
    async function convert(blocks, allBlocks, depth = 0) {
        let html = "";
        let numberCounter = 1;
        let listStack = []; // tracks open list elements: "ul", "ol", "todo"

        function closeListsUntilEmpty() {
            let out = "";
            while (listStack.length > 0) {
                const tag = listStack.pop();
                out += tag === "todo" ? `</ul>\n` : `</${tag}>\n`;
            }
            return out;
        }

        function closeListsIfNotType(type) {
            // Close list containers when switching to a different block type
            let out = "";
            const listTypes = {
                "bulleted_list_item": "ul",
                "numbered_list_item": "ol",
                "to_do": "todo"
            };
            const neededTag = listTypes[type];
            if (!neededTag && listStack.length > 0) {
                out += closeListsUntilEmpty();
            }
            return out;
        }

        function ensureListOpen(tag) {
            let out = "";
            // Close any different list if open
            if (listStack.length > 0 && listStack[listStack.length - 1] !== tag) {
                out += closeListsUntilEmpty();
            }
            if (listStack.length === 0) {
                if (tag === "todo") {
                    out += `<ul class="notion-to-do">\n`;
                } else {
                    out += `<${tag}>\n`;
                }
                listStack.push(tag);
            }
            return out;
        }

        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            const type = block.type;

            // ── Tab block handling ───────────────────────────────────────────────
            if (type === "tab") {
                html += closeListsIfNotType(type);

                if (!canFetch || !block.has_children) {
                    unsupportedHtmlBlocks.push(JSON.parse(JSON.stringify(block)));
                    continue;
                }

                let tabs = null;
                try {
                    tabs = await fetchBlockChildren(block.id, headers);
                    block.children = tabs;
                } catch (err) {
                    console.error(`[notionToHtml] Failed to fetch tab children (${block.id}):`, err.message || err);
                    unsupportedHtmlBlocks.push(JSON.parse(JSON.stringify(block)));
                    continue;
                }

                if (!tabs || tabs.length === 0) {
                    continue;
                }

                html += `<div class="notion-tabs">\n`;

                for (const tab of tabs) {
                    const tabData = tab[tab.type] || {};
                    const tabTitle = parseRichText(tabData.rich_text || []) || "Tab";
                    const tabTitlePlain = (tabData.rich_text || []).map(r => r.plain_text || "").join("") || "Tab";

                    let tabChildren = null;
                    if (tab.has_children) {
                        try {
                            tabChildren = await fetchBlockChildren(tab.id, headers);
                            tab.children = tabChildren;
                        } catch (err) {
                            console.error(`[notionToHtml] Failed to fetch tab content (${tab.id}):`, err.message || err);
                            tabChildren = [];
                        }
                    }

                    html += `<div class="notion-tab" data-title="${escapeHtml(tabTitlePlain)}">\n`;
                    html += `<h4>${tabTitle}</h4>\n`;

                    if (tabChildren && tabChildren.length > 0) {
                        html += await convert(tabChildren, allBlocks, depth);
                    }

                    html += `</div>\n`;
                }

                html += `</div>\n`;
                continue;
            }

            // ── Meeting notes / transcription handling ────────────────────────────
            if (type === "meeting_notes" || type === "transcription") {
                html += closeListsIfNotType(type);

                const meetingData = block[type] || {};
                const meetingTitle = parseRichText(meetingData.title || []) || "Meeting Notes";
                const meetingStatus = meetingData.status || "";
                const recordingTime = meetingData.recording?.start_time || "";
                const sectionIds = meetingData.children || {};

                html += `<div class="notion-meeting-notes">\n`;
                html += `<h2>📋 ${meetingTitle}</h2>\n`;

                const metaParts = [];
                if (meetingStatus) metaParts.push(`<strong>Status:</strong> ${escapeHtml(meetingStatus.replace(/_/g, " "))}`);
                if (recordingTime) metaParts.push(`<strong>Recording started:</strong> ${escapeHtml(recordingTime)}`);
                if (metaParts.length > 0) {
                    html += `<p class="notion-meeting-meta">${metaParts.join(" | ")}</p>\n`;
                }

                if (canFetch && block.has_children) {
                    const sectionMap = {
                        summary_block_id: "Summary",
                        notes_block_id: "Notes",
                        transcript_block_id: "Transcript"
                    };

                    let allChildren = null;
                    try {
                        allChildren = await fetchBlockChildren(block.id, headers);
                        block.children = allChildren;
                    } catch (err) {
                        console.error(`[notionToHtml] Failed to fetch meeting_notes children (${block.id}):`, err.message || err);
                    }

                    if (allChildren && allChildren.length > 0) {
                        for (const [idKey, label] of Object.entries(sectionMap)) {
                            const sectionBlockId = sectionIds[idKey];
                            const sectionBlock = sectionBlockId
                                ? allChildren.find(c => c.id === sectionBlockId)
                                : null;

                            html += `<h3>${escapeHtml(label)}</h3>\n`;

                            if (sectionBlock && sectionBlock.has_children) {
                                let sectionChildren = null;
                                try {
                                    sectionChildren = await fetchBlockChildren(sectionBlock.id, headers);
                                    sectionBlock.children = sectionChildren;
                                } catch (err) {
                                    console.error(`[notionToHtml] Failed to fetch meeting ${label} (${sectionBlock.id}):`, err.message || err);
                                }
                                if (sectionChildren && sectionChildren.length > 0) {
                                    html += await convert(sectionChildren, allBlocks, depth);
                                }
                            }
                        }
                    }
                } else {
                    unsupportedHtmlBlocks.push(JSON.parse(JSON.stringify(block)));
                }

                html += `</div>\n`;
                continue;
            }

            // ── Column layout handling ───────────────────────────────────────────
            if (type === "column_list") {
                html += closeListsIfNotType(type);

                if (!canFetch || !block.has_children) {
                    unsupportedHtmlBlocks.push(JSON.parse(JSON.stringify(block)));
                    continue;
                }

                let columns = Array.isArray(block.children) && block.children.length > 0
                    ? block.children
                    : null;

                try {
                    if (!columns) {
                        columns = await fetchBlockChildren(block.id, headers);
                        block.children = columns;
                    }
                } catch (err) {
                    console.error(`[notionToHtml] Failed to fetch column_list children (${block.id}):`, err.message || err);
                    unsupportedHtmlBlocks.push(JSON.parse(JSON.stringify(block)));
                    continue;
                }

                if (!columns || columns.length === 0) {
                    continue;
                }

                html += `<div class="notion-row">\n`;

                for (const col of columns) {
                    if (col.type !== "column") continue;

                    let colChildren = Array.isArray(col.children) && col.children.length > 0
                        ? col.children
                        : null;

                    if (!colChildren && col.has_children) {
                        try {
                            colChildren = await fetchBlockChildren(col.id, headers);
                            col.children = colChildren;
                        } catch (err) {
                            console.error(`[notionToHtml] Failed to fetch column children (${col.id}):`, err.message || err);
                            colChildren = [];
                        }
                    }

                    html += `<div class="notion-column">\n`;

                    if (colChildren && colChildren.length > 0) {
                        html += await convert(colChildren, allBlocks, depth);
                    }

                    html += `</div>\n`;
                }

                html += `</div>\n`;
                continue;
            }

            const data = block[type] || {};
            const text = parseRichText(data.rich_text || []);

            let line = "";

            // Close list containers before non-list blocks
            if (!["bulleted_list_item", "numbered_list_item", "to_do"].includes(type)) {
                html += closeListsIfNotType(type);
                numberCounter = 1;
            }

            switch (type) {
                case "paragraph":
                    if (text.trim()) line = `<p>${text}</p>\n`;
                    break;

                case "heading_1": {
                    const plainText = (data.rich_text || []).map(r => r.plain_text || "").join("").trim();
                    const anchor = plainText.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
                    line = `<h1 id="${anchor}">${text}</h1>\n`;
                    break;
                }
                case "heading_2": {
                    const plainText = (data.rich_text || []).map(r => r.plain_text || "").join("").trim();
                    const anchor = plainText.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
                    line = `<h2 id="${anchor}">${text}</h2>\n`;
                    break;
                }
                case "heading_3": {
                    const plainText = (data.rich_text || []).map(r => r.plain_text || "").join("").trim();
                    const anchor = plainText.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
                    line = `<h3 id="${anchor}">${text}</h3>\n`;
                    break;
                }

                case "bulleted_list_item":
                    html += ensureListOpen("ul");
                    line = `<li>${text}`;
                    // Children will be appended before closing </li>
                    break;

                case "numbered_list_item":
                    html += ensureListOpen("ol");
                    line = `<li>${text}`;
                    numberCounter++;
                    break;

                case "to_do": {
                    html += ensureListOpen("todo");
                    const checked = data.checked ? ' checked' : '';
                    line = `<li><label><input type="checkbox"${checked} disabled> ${text}</label>`;
                    break;
                }

                case "quote":
                    line = `<blockquote>${text}</blockquote>\n`;
                    break;

                case "code": {
                    const lang = data.language && data.language !== "plain text" ? data.language : "";
                    const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
                    line = `<pre><code${langClass}>${escapeHtml((data.rich_text || []).map(r => r.plain_text || "").join(""))}</code></pre>\n`;
                    break;
                }

                case "image": {
                    const imgCaption = parseRichText(data.caption || []);
                    const imgCaptionPlain = (data.caption || []).map(r => r.plain_text || "").join("") || "image";
                    const imgUrl = (data.external?.url) || (data.file?.url) || "";
                    if (imgUrl) {
                        line = `<figure><img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(imgCaptionPlain)}">`;
                        if (imgCaption) line += `<figcaption>${imgCaption}</figcaption>`;
                        line += `</figure>\n`;
                    }
                    break;
                }

                case "video": {
                    const vidCaption = parseRichText(data.caption || []);
                    const vidUrl = (data.external?.url) || (data.file?.url) || "";
                    if (vidUrl) {
                        const label = vidCaption || "Video";
                        line = `<div class="notion-video"><a href="${escapeHtml(vidUrl)}">▶ ${label}</a></div>\n`;
                    }
                    break;
                }

                case "audio": {
                    const audCaption = parseRichText(data.caption || []);
                    const audUrl = (data.external?.url) || (data.file?.url) || "";
                    if (audUrl) {
                        const label = audCaption || "Audio";
                        line = `<div class="notion-audio"><a href="${escapeHtml(audUrl)}">🔊 ${label}</a></div>\n`;
                    }
                    break;
                }

                case "file": {
                    const fileUrl = (data.external?.url) || (data.file?.url) || "";
                    const fileName = data.name || fileUrl.split("/").pop() || "file";
                    if (fileUrl) line = `<div class="notion-file"><a href="${escapeHtml(fileUrl)}">📎 ${escapeHtml(fileName)}</a></div>\n`;
                    break;
                }

                case "bookmark": {
                    const bmCaption = parseRichText(data.caption || []);
                    const bmUrl = data.url || "";
                    if (bmUrl) {
                        const label = bmCaption || escapeHtml(bmUrl);
                        line = `<div class="notion-bookmark"><a href="${escapeHtml(bmUrl)}">🔗 ${label}</a></div>\n`;
                    }
                    break;
                }

                case "pdf": {
                    const pdfUrl = (data.external?.url) || (data.file?.url) || "";
                    const pdfCaption = parseRichText(data.caption || []);
                    const pdfName = pdfCaption || escapeHtml(pdfUrl.split("/").pop() || "PDF");
                    if (pdfUrl) line = `<div class="notion-pdf"><a href="${escapeHtml(pdfUrl)}">📄 ${pdfName}</a></div>\n`;
                    break;
                }

                case "embed": {
                    const embedUrl = data.url || "";
                    const embedCaption = parseRichText(data.caption || []);
                    if (embedUrl) {
                        const label = embedCaption || escapeHtml(embedUrl);
                        line = `<div class="notion-embed"><a href="${escapeHtml(embedUrl)}">🌐 ${label}</a></div>\n`;
                    }
                    break;
                }

                case "equation": {
                    const expr = data.expression || "";
                    if (expr) line = `<div class="notion-equation">${escapeHtml(expr)}</div>\n`;
                    break;
                }

                case "divider":
                    line = `<hr>\n`;
                    numberCounter = 1;
                    break;

                case "table_of_contents":
                    line = generateToc(allBlocks);
                    break;

                case "toggle":
                    line = `<details>\n<summary>${text || "Toggle"}</summary>\n`;
                    break;

                case "callout": {
                    const emoji = data.icon?.emoji || "📌";
                    line = `<div class="notion-callout">\n<span class="notion-callout-icon">${emoji}</span>\n<div class="notion-callout-content">${text || "Callout"}</div>\n`;
                    break;
                }

                case "child_page": {
                    const childTitle = data.title || "Untitled page";
                    const childId = block.id;

                    if (parseChildPages && canFetch) {
                        try {
                            const pageChildren = await fetchBlockChildren(childId, headers);
                            block.children = pageChildren;
                            if (separateChildPage) {
                                const childResult = await convert(pageChildren, pageChildren, 0);
                                const childPageObj = {
                                    pageId: childId,
                                    title: childTitle,
                                };
                                if (outputResponse.includes("html")) {
                                    childPageObj.htmlContent = childResult.trim();
                                }
                                if (outputResponse.includes("blocks")) {
                                    childPageObj.blocks = pageChildren;
                                }
                                childPages.push(childPageObj);
                                line = `<p class="notion-child-page"><a href="#" data-page-id="${escapeHtml(childId)}">📄 ${escapeHtml(childTitle)}</a></p>\n`;
                            } else {
                                line = `<section class="notion-child-page">\n<h2>${escapeHtml(childTitle)}</h2>\n`;
                                line += await convert(pageChildren, pageChildren, depth);
                                line += `</section>\n`;
                            }
                        } catch (err) {
                            console.error(`Failed to fetch child page "${childTitle}" (${childId}):`, err);
                            line = `<p class="notion-child-page">[Child page: ${escapeHtml(childTitle)}] (page_id: ${escapeHtml(childId)})</p>\n`;
                        }
                    } else {
                        line = `<p class="notion-child-page">[Child page: ${escapeHtml(childTitle)}] (page_id: ${escapeHtml(childId)})</p>\n`;
                    }
                    break;
                }

                case "link_to_page": {
                    const linkedId = data.page_id || "(missing page id)";
                    const linkedTitle = (data.rich_text || []).map(r => r.plain_text || "").join("").trim() || "Linked page";
                    line = `<p class="notion-link-to-page">[Linked page: ${escapeHtml(linkedTitle)}] (page_id: ${escapeHtml(linkedId)})</p>\n`;
                    break;
                }

                case "child_database": {
                    const dbTitle = data.title || "Untitled database";
                    const dbId = block.id;
                    line = `<p class="notion-child-database">[Child database: ${escapeHtml(dbTitle)}] (database_id: ${escapeHtml(dbId)})</p>\n`;
                    break;
                }

                case "link_preview": {
                    const previewUrl = data.url || "";
                    if (previewUrl) {
                        line = `<p class="notion-link-preview"><a href="${escapeHtml(previewUrl)}">🔗 ${escapeHtml(previewUrl)}</a></p>\n`;
                    }
                    break;
                }

                case "table": {
                    let rows = Array.isArray(block.children) && block.children.length > 0 ? block.children : null;

                    if (!rows && parseChildPages && canFetch && block.has_children) {
                        try {
                            rows = await fetchBlockChildren(block.id, headers);
                            block.children = rows;
                        } catch (err) {
                            console.error(`Failed to fetch table rows (${block.id}):`, err);
                        }
                    }

                    if (rows && rows.length > 0) {
                        const tableWidth = data.table_width || 0;
                        const hasColHeader = data.has_column_header || false;
                        const hasRowHeader = data.has_row_header || false;

                        let tableHtml = `<table class="notion-table">\n`;

                        for (let ri = 0; ri < rows.length; ri++) {
                            const rowBlock = rows[ri];
                            if (rowBlock.type !== "table_row") continue;
                            const rowData = rowBlock.table_row || {};
                            const cells = rowData.cells || [];

                            const isHeaderRow = hasColHeader && ri === 0;
                            if (isHeaderRow) tableHtml += `<thead>\n`;
                            if (ri === 0 && !hasColHeader) tableHtml += `<tbody>\n`;
                            if (ri === 1 && hasColHeader) tableHtml += `<tbody>\n`;

                            tableHtml += `<tr>\n`;
                            for (let j = 0; j < tableWidth; j++) {
                                let cellText = parseRichText(cells[j] || []);
                                const isHeader = isHeaderRow || (hasRowHeader && j === 0);
                                const tag = isHeader ? "th" : "td";
                                tableHtml += `<${tag}>${cellText}</${tag}>\n`;
                            }
                            tableHtml += `</tr>\n`;

                            if (isHeaderRow) tableHtml += `</thead>\n`;
                        }

                        tableHtml += `</tbody>\n</table>\n`;
                        line = tableHtml;
                    } else {
                        unsupportedHtmlBlocks.push(JSON.parse(JSON.stringify(block)));
                        line = `<p>[Table Block] (block_id: ${escapeHtml(block.id)})</p>\n`;
                    }
                    break;
                }

                case "breadcrumb":
                    if (canFetch && block.parent) {
                        const breadcrumbParts = await fetchBreadcrumbs(block, headers);
                        const crumbsHtml = (Array.isArray(breadcrumbParts) ? breadcrumbParts : [breadcrumbParts])
                            .map(p => `<span class="notion-breadcrumb-item">${escapeHtml(p)}</span>`)
                            .join(`<span class="notion-breadcrumb-separator"> / </span>`);
                        line = `<nav class="notion-breadcrumb">${crumbsHtml}</nav>\n`;
                    } else {
                        unsupportedHtmlBlocks.push(JSON.parse(JSON.stringify(block)));
                        line = `<nav class="notion-breadcrumb">🏠 Breadcrumb</nav>\n`;
                    }
                    break;

                case "column":
                    // Should not be reached directly
                    unsupportedHtmlBlocks.push(JSON.parse(JSON.stringify(block)));
                    line = `<div class="notion-column">[Standalone column]</div>\n`;
                    break;

                case "synced_block":
                    if (!canFetch) {
                        unsupportedHtmlBlocks.push(JSON.parse(JSON.stringify(block)));
                    }
                    break;

                case "template":
                    line = `<details>\n<summary>${text || "Template"}</summary>\n`;
                    break;

                case "unsupported":
                    unsupportedHtmlBlocks.push(JSON.parse(JSON.stringify(block)));
                    if (text.trim()) line += `<p>${text}</p>\n`;
                    break;

                default:
                    unsupportedHtmlBlocks.push(JSON.parse(JSON.stringify(block)));
                    if (text.trim()) line += `<p>${text}</p>\n`;
                    break;
            }

            html += line;

            // ── Recurse children ─────────────────────────────────────────────────
            if (!["child_page", "table", "column_list", "column", "tab", "meeting_notes", "transcription"].includes(type) && block.has_children) {
                let children = Array.isArray(block.children) && block.children.length > 0
                    ? block.children
                    : null;

                if (!children && canFetch) {
                    try {
                        children = await fetchBlockChildren(block.id, headers);
                        block.children = children;
                    } catch (err) {
                        // silent fail
                    }
                }

                if (children && children.length > 0) {
                    html += await convert(children, allBlocks, depth + 1);
                }
            }

            // Close self-closing block elements that wrap children
            if (type === "toggle" || type === "template") {
                html += `</details>\n`;
            }
            if (type === "callout") {
                html += `</div>\n`;
            }
            // Close <li> for list items
            if (["bulleted_list_item", "numbered_list_item", "to_do"].includes(type)) {
                html += `</li>\n`;
            }
        }

        // Close any remaining open lists
        html += closeListsUntilEmpty();

        return html;
    }

    const htmlOutput = (await convert(blocks, blocks)).trim();

    const result = {};

    if (outputResponse.includes("html")) {
        result.htmlContent = htmlOutput;
        result.unsupportedHtmlBlocks = unsupportedHtmlBlocks.length ? unsupportedHtmlBlocks : [];
    }

    if (separateChildPage) {
        result.childPages = childPages;
    }

    if (outputResponse.includes("blocks")) {
        result.blocks = blocks;
    }

    if (canPaginate && paginationMeta) {
        result.next_cursor = paginationMeta.next_cursor;
        result.has_more = paginationMeta.has_more;
    }

    return result;
}

module.exports = notionToHtml;
