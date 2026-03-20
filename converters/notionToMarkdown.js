/**
 * Converts Notion API blocks array → Markdown string
 *
 * Features:
 * - Renders common blocks cleanly (paragraph, headings, lists, to-do, quote, code, divider)
 * - Renders toggle as bold list item + indented children
 * - Renders callout as quoted block with emoji (uses icon.emoji if present)
 * - Renders child_page / link_to_page with title + page_id
 * - Renders media blocks (image, video, audio, file, bookmark, pdf, embed) as Markdown links/images
 * - Renders equation blocks (block-level and inline)
 * - Generates table_of_contents from heading blocks
 * - Optionally fetches child blocks from Notion API (requires auth)
 * - Supports parseChildPages / separateChildPage config for child page handling
 * - Rate-limited API calls (~3 requests/second)
 * - Unsupported / exotic blocks → full unmodified raw block object in unsupportedMarkdownBlocks
 * - No HTML comments inside markdown output
 * - Uses JSON.parse(JSON.stringify()) for deep copy (compatible with older environments)
 * - Supports column_list + column layout using <div class="notion-row"> and <div class="notion-column">
 *
 * @param {Array}  blocks - Notion API blocks array
 * @param {Object} config - Optional configuration object
 * @param {boolean}       config.parseChildPages   - Fetch and process child page blocks (default: false)
 * @param {boolean}       config.separateChildPage - Return child pages separately instead of inlined (default: false)
 * @param {string|boolean} config.auth             - Notion auth: string = API key, true = no auth header (backend proxy), false/undefined = no API calls
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
            console.error(`[notionToMarkdown] Failed to fetch breadcrumb parent:`, err.message || err);
            break;
        }
    }

    return path.length > 0 ? path.join(" / ") : "🏠 Breadcrumb";
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
async function notionToMarkdown(blocks, config = {}) {
    if (!Array.isArray(blocks)) {
        return {
            markdownContent: "",
            unsupportedMarkdownBlocks: [{ error: "Input is not an array of blocks" }]
        };
    }

    const {
        parseChildPages = false,
        separateChildPage = false,
        auth = undefined
    } = config;

    const unsupportedMarkdownBlocks = [];
    const childPages = [];
    const canFetch = auth === true || typeof auth === "string";
    const headers = canFetch ? _buildHeaders(auth) : null;

    // ── Parse rich_text (official Notion API format) ───────────────────────────
    function parseRichText(richTextArray = []) {
        if (!Array.isArray(richTextArray) || richTextArray.length === 0) return "";

        return richTextArray.map(item => {
            let text = item.plain_text || "";

            if (!text) return "";

            // Inline equation
            if (item.type === "equation") {
                return `$${text}$`;
            }

            const ann = item.annotations || {};

            if (ann.bold) text = `**${text}**`;
            if (ann.italic) text = `*${text}*`;
            if (ann.strikethrough) text = `~~${text}~~`;
            if (ann.code) text = `\`${text}\``;
            if (ann.underline) text = `<u>${text}</u>`;

            if (item.href) {
                text = `[${text}](${item.href})`;
            }

            return text;
        }).join("");
    }

    // ── Generate Table of Contents from heading blocks ────────────────────────
    function generateToc(allBlocks) {
        const tree = [];
        const stack = [];

        for (const b of allBlocks) {
            if (b.type === "heading_1" || b.type === "heading_2" || b.type === "heading_3") {
                const headingData = b[b.type] || {};
                let headingText = parseRichText(headingData.rich_text || []);
                headingText = headingText.trim();
                if (!headingText) continue;

                const level = parseInt(b.type.split("_")[1]);
                const node = { text: headingText, level, children: [] };

                while (stack.length > 0 && stack[stack.length - 1].level >= level) {
                    stack.pop();
                }

                if (stack.length === 0) {
                    tree.push(node);
                } else {
                    stack[stack.length - 1].children.push(node);
                }

                stack.push(node);
            }
        }

        if (tree.length === 0) return "";

        function renderNode(node, prefix, isLast, isRoot) {
            let res = "";
            const hasChildren = node.children.length > 0;
            const suffix = hasChildren ? "/" : "";

            if (isRoot) {
                res += `${node.text}${suffix}\n`;
                if (hasChildren) {
                    res += `│\n`;
                    for (let i = 0; i < node.children.length; i++) {
                        const child = node.children[i];
                        const childIsLast = (i === node.children.length - 1);
                        res += renderNode(child, "", childIsLast, false);
                        if (!childIsLast) {
                            res += `│\n`;
                        }
                    }
                }
            } else {
                const connector = isLast ? "└── " : "├── ";
                res += `${prefix}${connector}${node.text}${suffix}\n`;
                if (hasChildren) {
                    const childPrefix = prefix + (isLast ? "    " : "│   ");
                    for (let i = 0; i < node.children.length; i++) {
                        const child = node.children[i];
                        const childIsLast = (i === node.children.length - 1);
                        res += renderNode(child, childPrefix, childIsLast, false);
                    }
                }
            }
            return res;
        }

        let tocStr = "";
        for (let i = 0; i < tree.length; i++) {
            tocStr += renderNode(tree[i], "", i === tree.length - 1, true);
            if (i < tree.length - 1) {
                tocStr += "\n";
            }
        }

        return `## Table of Content\n\n\`\`\`text\n${tocStr.trimEnd()}\n\`\`\`\n\n`;
    }

    // ── Core converter (async for API fetching) ──────────────────────────────
    async function convert(blocks, allBlocks, depth = 0) {
        const indent = "  ".repeat(depth);
        let md = "";
        let numberCounter = 1;
        let inRow = false;

        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            const type = block.type;

            // ── Column layout handling ───────────────────────────────────────────
            if (type === "column_list") {
                if (!canFetch || !block.has_children) {
                    unsupportedMarkdownBlocks.push(JSON.parse(JSON.stringify(block)));
                    continue;
                }

                let columns = Array.isArray(block.children) && block.children.length > 0
                    ? block.children
                    : null;

                try {
                    if (!columns) {
                        columns = await fetchBlockChildren(block.id, headers);
                    }
                } catch (err) {
                    console.error(`[notionToMarkdown] Failed to fetch column_list children (${block.id}):`, err.message || err);
                    unsupportedMarkdownBlocks.push(JSON.parse(JSON.stringify(block)));
                    continue;
                }

                if (!columns || columns.length === 0) {
                    continue;
                }

                md += `<div class="notion-row">\n\n`;
                inRow = true;

                for (const col of columns) {
                    if (col.type !== "column") continue;

                    let colChildren = Array.isArray(col.children) && col.children.length > 0
                        ? col.children
                        : null;

                    if (!colChildren && col.has_children) {
                        try {
                            colChildren = await fetchBlockChildren(col.id, headers);
                        } catch (err) {
                            console.error(`[notionToMarkdown] Failed to fetch column children (${col.id}):`, err.message || err);
                            colChildren = [];
                        }
                    }

                    let columnMd = `<div class="notion-column">\n\n`;

                    if (colChildren && colChildren.length > 0) {
                        columnMd += await convert(colChildren, allBlocks, depth);
                    }

                    columnMd += `</div>\n\n`;

                    md += columnMd;
                }

                continue;
            }

            // Close row when leaving column_list context
            if (inRow && type !== "column_list" && type !== "column") {
                md += `</div>\n\n`;
                inRow = false;
            }

            const data = block[type] || {};
            const text = parseRichText(data.rich_text || []);

            let line = "";

            switch (type) {
                case "paragraph":
                    if (text.trim()) line = `${text}\n\n`;
                    break;

                case "heading_1":
                    line = `# ${text}\n\n`;
                    break;
                case "heading_2":
                    line = `## ${text}\n\n`;
                    break;
                case "heading_3":
                    line = `### ${text}\n\n`;
                    break;

                case "bulleted_list_item":
                    line = `${indent}- ${text}\n`;
                    numberCounter = 1;
                    break;

                case "numbered_list_item":
                    line = `${indent}${numberCounter}. ${text}\n`;
                    numberCounter++;
                    break;

                case "to_do":
                    const checked = data.checked ? "x" : " ";
                    line = `${indent}- [${checked}] ${text}\n`;
                    numberCounter = 1;
                    break;

                case "quote":
                    line = `${indent}> ${text.replace(/\n/g, `\n${indent}> `)}\n\n`;
                    break;

                case "code":
                    const lang = data.language && data.language !== "plain text" ? data.language : "";
                    line = `\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
                    break;

                case "image": {
                    const imgCaption = parseRichText(data.caption || []) || "image";
                    const imgUrl = (data.external?.url) || (data.file?.url) || "";
                    if (imgUrl) line = `![${imgCaption}](${imgUrl})\n\n`;
                    break;
                }

                case "video": {
                    const vidCaption = parseRichText(data.caption || []);
                    const vidUrl = (data.external?.url) || (data.file?.url) || "";
                    if (vidUrl) {
                        line = vidCaption ? `[▶ ${vidCaption}](${vidUrl})\n\n` : `[▶ Video](${vidUrl})\n\n`;
                    }
                    break;
                }

                case "audio": {
                    const audCaption = parseRichText(data.caption || []);
                    const audUrl = (data.external?.url) || (data.file?.url) || "";
                    if (audUrl) {
                        line = audCaption ? `[🔊 ${audCaption}](${audUrl})\n\n` : `[🔊 Audio](${audUrl})\n\n`;
                    }
                    break;
                }

                case "file": {
                    const fileUrl = (data.external?.url) || (data.file?.url) || "";
                    const fileName = data.name || fileUrl.split("/").pop() || "file";
                    if (fileUrl) line = `[📎 ${fileName}](${fileUrl})\n\n`;
                    break;
                }

                case "bookmark": {
                    const bmCaption = parseRichText(data.caption || []);
                    const bmUrl = data.url || "";
                    if (bmUrl) {
                        line = bmCaption ? `[🔗 ${bmCaption}](${bmUrl})\n\n` : `[🔗 ${bmUrl}](${bmUrl})\n\n`;
                    }
                    break;
                }

                case "pdf": {
                    const pdfUrl = (data.external?.url) || (data.file?.url) || "";
                    const pdfCaption = parseRichText(data.caption || []);
                    const pdfName = pdfCaption || pdfUrl.split("/").pop() || "PDF";
                    if (pdfUrl) line = `[📄 ${pdfName}](${pdfUrl})\n\n`;
                    break;
                }

                case "embed": {
                    const embedUrl = data.url || "";
                    const embedCaption = parseRichText(data.caption || []);
                    if (embedUrl) {
                        line = embedCaption ? `[🌐 ${embedCaption}](${embedUrl})\n\n` : `[🌐 ${embedUrl}](${embedUrl})\n\n`;
                    }
                    break;
                }

                case "equation": {
                    const expr = data.expression || "";
                    if (expr) line = `$$${expr}$$\n\n`;
                    break;
                }

                case "divider":
                    line = `${indent}---\n\n`;
                    numberCounter = 1;
                    break;

                case "table_of_contents":
                    line = generateToc(allBlocks);
                    break;

                case "toggle":
                    line = `${indent}- **${text || "Toggle"}**\n`;
                    break;

                case "callout": {
                    const emoji = data.icon?.emoji || "📌";
                    line = `${indent}> **${emoji} ${text || "Callout"}**\n`;
                    break;
                }

                case "child_page": {
                    const childTitle = data.title || "Untitled page";
                    const childId = block.id;

                    if (parseChildPages && canFetch) {
                        try {
                            const pageChildren = await fetchBlockChildren(childId, headers);
                            if (separateChildPage) {
                                const childResult = await convert(pageChildren, pageChildren, 0);
                                childPages.push({
                                    pageId: childId,
                                    title: childTitle,
                                    markdownContent: childResult.trim()
                                });
                                line = `${indent}[Child page: ${childTitle}] (page_id: ${childId})\n\n`;
                            } else {
                                line = `${indent}## ${childTitle}\n\n`;
                                line += await convert(pageChildren, pageChildren, depth);
                            }
                        } catch (err) {
                            console.error(`Failed to fetch child page "${childTitle}" (${childId}):`, err);
                            line = `${indent}[Child page: ${childTitle}] (page_id: ${childId})\n\n`;
                        }
                    } else {
                        line = `${indent}[Child page: ${childTitle}] (page_id: ${childId})\n\n`;
                    }
                    break;
                }

                case "link_to_page": {
                    const linkedId = data.page_id || "(missing page id)";
                    const linkedTitle = text.trim() || "Linked page";
                    line = `${indent}[Linked page: ${linkedTitle}] (page_id: ${linkedId})\n\n`;
                    break;
                }

                case "table": {
                    let rows = Array.isArray(block.children) && block.children.length > 0 ? block.children : null;

                    if (!rows && parseChildPages && canFetch && block.has_children) {
                        try {
                            rows = await fetchBlockChildren(block.id, headers);
                        } catch (err) {
                            console.error(`Failed to fetch table rows (${block.id}):`, err);
                        }
                    }

                    if (rows && rows.length > 0) {
                        const tableWidth = data.table_width || 0;
                        const hasColHeader = data.has_column_header || false;
                        const hasRowHeader = data.has_row_header || false;

                        let tableMd = "";

                        if (!hasColHeader) {
                            let emptyHeader = "|";
                            let sepStr = "|";
                            for (let j = 0; j < tableWidth; j++) {
                                emptyHeader += "   |";
                                sepStr += "---|";
                            }
                            tableMd += `${indent}${emptyHeader}\n${indent}${sepStr}\n`;
                        }

                        for (let i = 0; i < rows.length; i++) {
                            const rowBlock = rows[i];
                            if (rowBlock.type !== "table_row") continue;
                            const rowData = rowBlock.table_row || {};
                            const cells = rowData.cells || [];

                            let rowStr = "|";
                            for (let j = 0; j < tableWidth; j++) {
                                let cellText = parseRichText(cells[j] || []);
                                cellText = cellText.replace(/\n/g, "<br>");

                                if (hasRowHeader && j === 0) {
                                    cellText = `**${cellText}**`;
                                } else if (hasColHeader && i === 0) {
                                    cellText = `**${cellText}**`;
                                }

                                rowStr += ` ${cellText} |`;
                            }
                            tableMd += `${indent}${rowStr}\n`;

                            if (hasColHeader && i === 0) {
                                let sepStr = "|";
                                for (let j = 0; j < tableWidth; j++) {
                                    sepStr += "---|";
                                }
                                tableMd += `${indent}${sepStr}\n`;
                            }
                        }

                        line = `${tableMd}\n`;
                    } else {
                        unsupportedMarkdownBlocks.push(JSON.parse(JSON.stringify(block)));
                        line = `${indent}[Table Block] (block_id: ${block.id})\n\n`;
                    }
                    break;
                }

                case "breadcrumb":
                    if (canFetch && block.parent) {
                        const breadcrumbText = await fetchBreadcrumbs(block, headers);
                        line = `${indent}${breadcrumbText}\n\n`;
                    } else {
                        unsupportedMarkdownBlocks.push(JSON.parse(JSON.stringify(block)));
                        line = `${indent}🏠 Breadcrumb\n\n`;
                    }
                    break;

                case "column":
                    // Should not be reached directly
                    unsupportedMarkdownBlocks.push(JSON.parse(JSON.stringify(block)));
                    line = `${indent}[Standalone column]\n\n`;
                    break;

                case "synced_block":
                case "template":
                case "unsupported":
                    unsupportedMarkdownBlocks.push(JSON.parse(JSON.stringify(block)));
                    if (text.trim()) line += `${indent}${text}\n\n`;
                    break;

                default:
                    unsupportedMarkdownBlocks.push(JSON.parse(JSON.stringify(block)));
                    if (text.trim()) line += `${indent}${text}\n\n`;
                    break;
            }

            md += line;

            // ── Recurse children ─────────────────────────────────────────────────
            if (!["child_page", "table", "column_list", "column"].includes(type) && block.has_children) {
                let children = Array.isArray(block.children) && block.children.length > 0
                    ? block.children
                    : null;

                if (!children && canFetch) {
                    try {
                        children = await fetchBlockChildren(block.id, headers);
                    } catch (err) {
                        // silent fail
                    }
                }

                if (children && children.length > 0) {
                    const extra = ["bulleted_list_item", "numbered_list_item", "to_do", "toggle"].includes(type) ? 1 : 0;
                    md += await convert(children, allBlocks, depth + extra);
                }
            }
        }

        if (inRow) {
            md += `</div>\n\n`;
        }

        return md;
    }

    const markdown = (await convert(blocks, blocks)).trim();

    const result = {
        markdownContent: markdown,
        unsupportedMarkdownBlocks: unsupportedMarkdownBlocks.length ? unsupportedMarkdownBlocks : []
    };

    if (separateChildPage) {
        result.childPages = childPages;
    }

    return result;
}

module.exports = notionToMarkdown;