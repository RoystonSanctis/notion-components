# Notion → Markdown Converter

Converts a Notion API block array into a **Markdown** string.

> Part of [notion-components](./README.md) — see also [notionToHtml.md](./notionToHtml.md)

---

## Supported Blocks

| Block Type | Markdown Output |
|-------------|----------------|
| paragraph | Plain text |
| heading_1 | `# Heading` |
| heading_2 | `## Heading` |
| heading_3 | `### Heading` |
| bulleted_list_item | `- Item` |
| numbered_list_item | `1. Item` |
| to_do | `- [x] Task` |
| quote | `> Quote` |
| code | Fenced code block with language |
| divider | `---` |
| toggle | Bold list item with nested content |
| callout | Quoted block with emoji |
| child_page | Page reference |
| link_to_page | Linked page reference |
| image | `![caption](url)` |
| video | `[▶ Video](url)` |
| audio | `[🔊 Audio](url)` |
| file | `[📎 filename](url)` |
| bookmark | `[🔗 url](url)` |
| pdf | `[📄 filename](url)` |
| embed | `[🌐 url](url)` |
| equation | `$$expression$$` (block) / `$expression$` (inline) |
| table | Table with row/column headers |
| table_of_contents | Auto-generated TOC from headings |
| breadcrumb | Fetch parent page/database/data_source recursively to build breadcrumb |
| column_list | HTML row (`<div class="notion-row">`) with nested columns |
| column | HTML column (`<div class="notion-column">`) |
| tab | Tabbed content (`<div class="notion-tabs">` / `<div class="notion-tab">`) |
| meeting_notes | Meeting notes with Summary, Notes, Transcript sections |
| synced_block | Synced block content (original and references) rendered transparently |
| child_database | `[Child database: title] (database_id: id)` |
| link_preview | `[🔗 url](url)` |
| template | Deprecated; renders like toggle with rich text + children |
| transcription | Alias for `meeting_notes` (renamed in API v2026-03-11) |

## Inline Mentions

Rich text mentions are rendered with context-aware formatting:

| Mention Type | Markdown Output | Example |
|-------------|----------------|---------|
| Date (plain) | `@2026-03-22` | Date-only mention |
| Date (with time / reminder) | `@2026-03-23T09:00:00.000+05:30 ⏰` | Reminder detected by time component |
| Date range | `@start → end` | When end date is present |
| User | `@Name (user_id: id)` | Includes user ID |
| Page | `[📄 title](notion_url)` | Clickable link to the page |
| Database | `[🗄️ title](notion_url)` | Clickable link to the database |
| Link mention | Thumbnail + `[🌐 title](url)` + description + icon | Rich preview with all metadata |
| Link preview | `[🔗 text](url)` | Clickable preview link |

Unsupported blocks are stored separately for further processing.

---

## Example Usage

```javascript
import notionToMarkdown from "./converters/notionToMarkdown.js"

// Basic usage (no API calls)
const result = await notionToMarkdown(notionBlocks)

// With Notion API auth (fetches child blocks automatically)
const result = await notionToMarkdown(notionBlocks, {
  auth: "ntn_your_api_key"
})

// With child page parsing (inline)
const result = await notionToMarkdown(notionBlocks, {
  auth: "ntn_your_api_key",
  parseChildPages: true
})

// With child page parsing (separate)
const result = await notionToMarkdown(notionBlocks, {
  auth: "ntn_your_api_key",
  parseChildPages: true,
  separateChildPage: true,
  outputResponse: ["markdown", "blocks"]
})
// result.childPages → [{ pageId, title, markdownContent, blocks }]

// Using a block ID instead of blocks array (fetches from API)
const result = await notionToMarkdown("block-id-string", {
  auth: "ntn_your_api_key"
})

// With pagination — fetch only 1 page
const page1 = await notionToMarkdown("block-id-string", {
  auth: "ntn_your_api_key",
  canPaginate: true,
  pageSize: 50
})
console.log(page1.next_cursor) // cursor for next page
console.log(page1.has_more)    // true if more pages exist

// Fetch next page using cursor
const page2 = await notionToMarkdown("block-id-string", {
  auth: "ntn_your_api_key",
  canPaginate: true,
  pageSize: 50,
  startCursor: page1.next_cursor
})

// Limit total pages fetched (fetch all but cap at 3 pages)
const result = await notionToMarkdown("block-id-string", {
  auth: "ntn_your_api_key",
  pageLimit: 3
})

console.log(result.markdownContent)
console.log(result.unsupportedMarkdownBlocks)
```

---

## Output Structure

```javascript
{
  markdownContent: "Converted markdown text", // only when outputResponse includes "markdown"
  unsupportedMarkdownBlocks: [],              // only when outputResponse includes "markdown"
  childPages: [],     // only when separateChildPage is true
  blocks: [],         // only when outputResponse includes "blocks"
  next_cursor: null,  // only when blocks is a string (block ID)
  has_more: false     // only when blocks is a string (block ID)
}
```

---

## API Reference

### `await notionToMarkdown(blocks, config)`

Converts a Notion block array into Markdown. The function is **async** since it can optionally fetch child blocks from the Notion API.

#### Parameters

- **blocks**: `Array | string`
  An array of blocks from the Notion API, or a **block ID string** (requires `auth`). When a string is provided, blocks are fetched from the API.
- **config**: `Object` *(optional)*
  Configuration object. Defaults to `{}`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `auth` | `string \| boolean` | `undefined` | API key string → sent as `Bearer` token. `true` → API calls without auth header (backend proxy). `false` / `undefined` → no API calls. |
| `parseChildPages` | `boolean` | `false` | When `true` and `auth` is provided, fetches and processes child page content. |
| `separateChildPage` | `boolean` | `false` | When `true`, child pages are returned in a separate `childPages` array instead of being inlined. |
| `pageSize` | `number` | `100` | API page size for the top-level fetch (max 100). Only works when `canPaginate` is `true` and `blocks` is a string. |
| `startCursor` | `string` | `undefined` | Cursor to resume pagination from a previous response's `next_cursor`. Only works when `canPaginate` is `true` and `blocks` is a string. |
| `canPaginate` | `boolean` | `false` | `true` = fetch only 1 page (returns `next_cursor`/`has_more`). `false` = fetch all pages. |
| `pageLimit` | `number` | `undefined` | Max pages to fetch when `canPaginate` is `false`. Ignored when `canPaginate` is `true`. |
| `outputResponse` | `array` | `["markdown"]` | Array configuration specifying output. `["markdown"]` returns generated markdown strings. `["blocks"]` returns the nested Notion blocks tree with fetched children. Includes both if both are specified. |

#### Returns

```javascript
{
  markdownContent: string,             // only when outputResponse includes "markdown"
  unsupportedMarkdownBlocks: array,    // only when outputResponse includes "markdown"
  childPages: array,   // only when separateChildPage is true
  blocks: array,       // only when outputResponse includes "blocks"
  next_cursor: string, // only when blocks is a string (block ID)
  has_more: boolean    // only when blocks is a string (block ID)
}
```

#### Rate Limiting

When making Notion API calls, requests are rate-limited to ~3 per second (334ms minimum gap) to stay within Notion's rate limits.
