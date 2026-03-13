/**
 * Converts Notion API blocks array → Markdown string
 *
 * Features:
 * - Renders common blocks cleanly (paragraph, headings, lists, to-do, quote, code, divider)
 * - Renders toggle as bold list item + indented children
 * - Renders callout as quoted block with emoji (uses icon.emoji if present)
 * - Renders child_page / link_to_page with title + page_id
 * - Unsupported / exotic blocks → full unmodified raw block object in unsupportedMarkdownBlocks
 * - No HTML comments inside markdown output
 * - Uses JSON.parse(JSON.stringify()) for deep copy (compatible with older environments)
 */
function notionToMarkdown(blocks) {
    if (!Array.isArray(blocks)) {
        return {
            markdownContent: "",
            unsupportedMarkdownBlocks: [{ error: "Input is not an array of blocks" }]
        };
    }

    const unsupportedMarkdownBlocks = [];

    // ── Parse rich_text (official Notion API format) ───────────────────────────
    function parseRichText(richTextArray = []) {
        if (!Array.isArray(richTextArray) || richTextArray.length === 0) return "";

        return richTextArray.map(item => {
            let text = item.plain_text || "";

            if (!text) return "";

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

    function convert(blocks, depth = 0) {
        const indent = "  ".repeat(depth);
        let md = "";
        let numberCounter = 1;

        for (const block of blocks) {
            const type = block.type;
            const data = block[type] || {};
            const text = parseRichText(data.rich_text || []);

            let line = "";

            switch (type) {
                // ── Fully rendered ───────────────────────────────────────────────────
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

                case "divider":
                    line = `${indent}---\n\n`;
                    numberCounter = 1;
                    break;

                // ── Rendered with approximation ──────────────────────────────────────
                case "toggle":
                    line = `${indent}- **${text || "Toggle"}**\n`;
                    break;

                case "callout":
                    let emoji = data.icon?.emoji || "📌";
                    line = `${indent}> **${emoji} ${text || "Callout"}**\n`;
                    break;

                // ── Rendered with page reference ─────────────────────────────────────
                case "child_page":
                    const childTitle = data.title || "Untitled page";
                    const childId = block.id; // child_page uses own block id as page id
                    line = `${indent}[Child page: ${childTitle}] (page_id: ${childId})\n\n`;
                    break;

                case "link_to_page":
                    const linkedId = data.page_id || "(missing page id)";
                    const linkedTitle = text.trim() || "Linked page";
                    line = `${indent}[Linked page: ${linkedTitle}] (page_id: ${linkedId})\n\n`;
                    break;

                // ── Not rendered → store full unmodified raw block via JSON copy ──────
                case "table":
                case "image":
                case "video":
                case "pdf":
                case "file":
                case "embed":
                case "bookmark":
                case "equation":
                case "synced_block":
                case "template":
                case "column_list":
                case "breadcrumb":
                case "table_of_contents":
                case "unsupported":
                    unsupportedMarkdownBlocks.push(JSON.parse(JSON.stringify(block)));
                    if (md.trim() !== "" && !text.trim()) {
                        line = "---\n\n";
                    }
                    if (text.trim()) {
                        line += `${indent}${text}\n\n`;
                    }
                    break;

                default:
                    unsupportedMarkdownBlocks.push(JSON.parse(JSON.stringify(block)));
                    if (md.trim() !== "" && !text.trim()) {
                        line = "---\n\n";
                    }
                    if (text.trim()) {
                        line += `${indent}${text}\n\n`;
                    }
                    break;
            }

            md += line;

            // ── Recurse children ─────────────────────────────────────────────────
            if (block.has_children && Array.isArray(block.children) && block.children.length > 0) {
                const extra = ["bulleted_list_item", "numbered_list_item", "to_do", "toggle"].includes(type) ? 1 : 0;
                md += convert(block.children, depth + extra);
            }
        }

        return md;
    }

    const markdown = convert(blocks).trim();

    return {
        markdownContent: markdown,
        unsupportedMarkdownBlocks: unsupportedMarkdownBlocks.length ? unsupportedMarkdownBlocks : []
    };
}