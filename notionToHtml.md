# Notion → HTML Converter

Converts a Notion API block array into an **HTML** string.

> Part of [notion-components](./README.md) — see also [notionToMarkdown.md](./notionToMarkdown.md)

---

## Supported Blocks

| Block Type | HTML Output |
|-------------|------------|
| paragraph | `<p>` |
| heading_1 | `<h1 id="anchor">` |
| heading_2 | `<h2 id="anchor">` |
| heading_3 | `<h3 id="anchor">` |
| bulleted_list_item | `<ul><li>` |
| numbered_list_item | `<ol><li>` |
| to_do | `<ul class="notion-to-do"><li><label><input type="checkbox">` |
| quote | `<blockquote>` |
| code | `<pre><code class="language-x">` |
| divider | `<hr>` |
| toggle | `<details><summary>` |
| callout | `<div class="notion-callout">` with emoji icon |
| child_page | `<p class="notion-child-page">` / `<section>` when parsed |
| link_to_page | `<p class="notion-link-to-page">` |
| image | `<figure><img>` + `<figcaption>` |
| video | `<div class="notion-video"><a>▶</a>` |
| audio | `<div class="notion-audio"><a>🔊</a>` |
| file | `<div class="notion-file"><a>📎</a>` |
| bookmark | `<div class="notion-bookmark"><a>🔗</a>` |
| pdf | `<div class="notion-pdf"><a>📄</a>` |
| embed | `<div class="notion-embed"><a>🌐</a>` |
| equation | `<div class="notion-equation">` (block) / `<span class="notion-equation">` (inline) |
| table | `<table>` with `<thead>` / `<tbody>` / `<th>` / `<td>` |
| table_of_contents | `<nav class="notion-toc"><ul>` |
| breadcrumb | `<nav class="notion-breadcrumb">` with separator spans |
| column_list | `<div class="notion-row">` |
| column | `<div class="notion-column">` |
| tab | `<div class="notion-tabs">` / `<div class="notion-tab">` |
| meeting_notes | `<div class="notion-meeting-notes">` with `<h3>` sections |
| synced_block | Transparent — renders children directly |
| child_database | `<p class="notion-child-database">` |
| link_preview | `<p class="notion-link-preview"><a>` |
| template | `<details><summary>` (deprecated) |
| transcription | Alias for `meeting_notes` (renamed in API v2026-03-11) |

## Inline Rich Text

| Format | HTML Output |
|--------|------------|
| Bold | `<strong>` |
| Italic | `<em>` |
| Strikethrough | `<s>` |
| Code | `<code>` |
| Underline | `<u>` |
| Link | `<a href="...">` |
| Color | `<span style="color: ...">` |
| Background color | `<span style="background-color: ...">` |
| Equation (inline) | `<span class="notion-equation">` |

## Inline Mentions

| Mention Type | HTML Output |
|-------------|------------|
| Date (plain) | `<span class="notion-mention notion-date">@2026-03-22</span>` |
| Date (with reminder) | `<span class="notion-mention notion-date">@2026-03-23T... ⏰</span>` |
| Date range | `<span class="notion-mention notion-date">@start → end</span>` |
| User | `<span class="notion-mention notion-user">@Name (user_id: id)</span>` |
| Page | `<a class="notion-mention notion-page" href="...">📄 title</a>` |
| Database | `<a class="notion-mention notion-database" href="...">🗄️ title</a>` |
| Link mention | `<img>` thumbnail + `<a class="notion-mention notion-link-mention">🌐 title</a>` + description |
| Link preview | `<a class="notion-mention notion-link-preview">🔗 text</a>` |

Unsupported blocks are stored separately for further processing.

---

## Example Usage

```javascript
import notionToHtml from "./converters/notionToHtml.js"

// Basic usage (no API calls)
const result = await notionToHtml(notionBlocks)

// With Notion API auth (fetches child blocks automatically)
const result = await notionToHtml(notionBlocks, {
  auth: "ntn_your_api_key"
})

// With child page parsing (inline)
const result = await notionToHtml(notionBlocks, {
  auth: "ntn_your_api_key",
  parseChildPages: true
})

// With child page parsing (separate)
const result = await notionToHtml(notionBlocks, {
  auth: "ntn_your_api_key",
  parseChildPages: true,
  separateChildPage: true,
  outputResponse: ["html", "blocks"]
})
// result.childPages → [{ pageId, title, htmlContent, blocks }]

// Using a block ID instead of blocks array (fetches from API)
const result = await notionToHtml("block-id-string", {
  auth: "ntn_your_api_key"
})

// With pagination — fetch only 1 page
const page1 = await notionToHtml("block-id-string", {
  auth: "ntn_your_api_key",
  canPaginate: true,
  pageSize: 50
})
console.log(page1.next_cursor) // cursor for next page
console.log(page1.has_more)    // true if more pages exist

// Fetch next page using cursor
const page2 = await notionToHtml("block-id-string", {
  auth: "ntn_your_api_key",
  canPaginate: true,
  pageSize: 50,
  startCursor: page1.next_cursor
})

// Limit total pages fetched (fetch all but cap at 3 pages)
const result = await notionToHtml("block-id-string", {
  auth: "ntn_your_api_key",
  pageLimit: 3
})

console.log(result.htmlContent)
console.log(result.unsupportedHtmlBlocks)
```

---

## Output Structure

```javascript
{
  htmlContent: "Converted HTML string",    // only when outputResponse includes "html"
  unsupportedHtmlBlocks: [],               // only when outputResponse includes "html"
  childPages: [],     // only when separateChildPage is true
  blocks: [],         // only when outputResponse includes "blocks"
  next_cursor: null,  // only when blocks is a string (block ID)
  has_more: false     // only when blocks is a string (block ID)
}
```

---

## API Reference

### `await notionToHtml(blocks, config)`

Converts a Notion block array into HTML. The function is **async** since it can optionally fetch child blocks from the Notion API.

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
| `outputResponse` | `array` | `["html"]` | Array configuration specifying output. `["html"]` returns generated HTML string. `["blocks"]` returns the nested Notion blocks tree with fetched children. Includes both if both are specified. |

#### Returns

```javascript
{
  htmlContent: string,             // only when outputResponse includes "html"
  unsupportedHtmlBlocks: array,    // only when outputResponse includes "html"
  childPages: array,   // only when separateChildPage is true
  blocks: array,       // only when outputResponse includes "blocks"
  next_cursor: string, // only when blocks is a string (block ID)
  has_more: boolean    // only when blocks is a string (block ID)
}
```

#### Rate Limiting

When making Notion API calls, requests are rate-limited to ~3 per second (334ms minimum gap) to stay within Notion's rate limits.

---

## CSS Classes Reference

The HTML converter uses the following CSS class names that you can style:

| Class | Element | Purpose |
|-------|---------|---------|
| `notion-to-do` | `<ul>` | To-do list container |
| `notion-callout` | `<div>` | Callout wrapper |
| `notion-callout-icon` | `<span>` | Callout emoji icon |
| `notion-callout-content` | `<div>` | Callout text |
| `notion-row` | `<div>` | Column layout row |
| `notion-column` | `<div>` | Individual column |
| `notion-tabs` | `<div>` | Tabs container |
| `notion-tab` | `<div>` | Individual tab panel |
| `notion-table` | `<table>` | Table |
| `notion-toc` | `<nav>` | Table of contents |
| `notion-toc-level-{1,2,3}` | `<li>` | TOC heading level |
| `notion-breadcrumb` | `<nav>` | Breadcrumb container |
| `notion-breadcrumb-item` | `<span>` | Breadcrumb segment |
| `notion-breadcrumb-separator` | `<span>` | Breadcrumb separator |
| `notion-meeting-notes` | `<div>` | Meeting notes wrapper |
| `notion-meeting-meta` | `<p>` | Meeting metadata |
| `notion-equation` | `<div>` / `<span>` | Block / inline equation |
| `notion-video` | `<div>` | Video link wrapper |
| `notion-audio` | `<div>` | Audio link wrapper |
| `notion-file` | `<div>` | File link wrapper |
| `notion-bookmark` | `<div>` | Bookmark wrapper |
| `notion-pdf` | `<div>` | PDF link wrapper |
| `notion-embed` | `<div>` | Embed wrapper |
| `notion-child-page` | `<p>` / `<section>` | Child page reference |
| `notion-link-to-page` | `<p>` | Linked page reference |
| `notion-child-database` | `<p>` | Child database reference |
| `notion-link-preview` | `<p>` | Link preview |
| `notion-mention` | `<span>` / `<a>` | Inline mention |
| `notion-date` | modifier | Date mention |
| `notion-user` | modifier | User mention |
| `notion-page` | modifier | Page mention |
| `notion-database` | modifier | Database mention |
| `notion-link-mention` | modifier | Link mention |
| `notion-link-preview` | modifier | Link preview mention |
| `notion-link-thumbnail` | `<img>` | Link mention thumbnail |
| `notion-link-description` | `<span>` | Link mention description |
| `notion-link-icon` | `<img>` | Link mention icon |
