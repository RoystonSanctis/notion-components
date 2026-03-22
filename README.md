# Notion Components

A collection of reusable components for working with the **Notion API**.

This repository contains essential utilities used in **viaSocket Automation** to process, transform, and manipulate Notion content programmatically.

The goal of this project is to provide **reliable conversion tools between Notion blocks and Markdown**, making it easier to integrate Notion into automation pipelines, content workflows, and developer tools.

---

## Features

- Convert **Notion Blocks → Markdown**
- Preserve **rich text formatting**
- Handle **nested blocks**
- Support for common Notion block types
- Graceful fallback for unsupported blocks
- Clean Markdown output
- Structured reporting of unsupported blocks

Future tools planned:

- Markdown → Notion block converter
- Notion block utilities
- Content automation helpers

---

## Repository Purpose

This repository exists to store the **core Notion transformation logic** used internally in **viaSocket automation workflows**.

It focuses on:

- Converting Notion data structures
- Standardizing content transformations
- Making Notion automation easier for developers

---

## Current Tools

### 1. Notion → Markdown Converter

Converts a Notion API block array into a Markdown string.

#### Supported Blocks

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

#### Inline Mentions

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
import notionToMarkdown from "./notionToMarkdown.js"

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
  separateChildPage: true
})
// result.childPages → [{ pageId, title, markdownContent }]

console.log(result.markdownContent)
console.log(result.unsupportedMarkdownBlocks)
```

**Output structure:**

```javascript
{
  markdownContent: "Converted markdown text",
  unsupportedMarkdownBlocks: [],
  childPages: []  // only included when separateChildPage is true
}
```

## Function Overview

### `await notionToMarkdown(blocks, config)`

Converts a Notion block array into Markdown. The function is **async** since it can optionally fetch child blocks from the Notion API.

#### Parameters

- **blocks**: `Array`
  The array of blocks returned from the Notion API.
- **config**: `Object` *(optional)*
  Configuration object. Defaults to `{}`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `auth` | `string \| boolean` | `undefined` | API key string → sent as `Bearer` token. `true` → API calls without auth header (backend proxy). `false` / `undefined` → no API calls. |
| `parseChildPages` | `boolean` | `false` | When `true` and `auth` is provided, fetches and processes child page content. |
| `separateChildPage` | `boolean` | `false` | When `true`, child pages are returned in a separate `childPages` array instead of being inlined. Only used when `parseChildPages` is `true`. |

#### Returns

```javascript
{
  markdownContent: string,
  unsupportedMarkdownBlocks: array,
  childPages: array  // only when separateChildPage is true
}
```

#### Rate Limiting

When making Notion API calls, requests are rate-limited to ~3 per second (334ms minimum gap) to stay within Notion's rate limits.

## Design Principles

- Clean Markdown output
- Preserve as much Notion structure as possible
- Never silently discard unsupported blocks
- Keep functions portable and dependency-free

## Planned Features

Upcoming utilities:

- Markdown → Notion block converter
- Notion rich text utilities
- Notion page export tools

## Use Cases

This library is useful for:

- Automation platforms
- Static site generators
- Knowledge base exports
- Content synchronization
- Notion backup tools

## Project Structure

```text
notion-components/
│
├── converters/
│   └── notionToMarkdown.js
│
├── utils/
│
├── examples/
│
└── README.md
```

## Contributing

Contributions are welcome.

If you want to improve support for additional Notion block types or add new converters, feel free to open a pull request. For major changes, please open an issue first to discuss what you would like to change.

## Contributors

<a href="https://github.com/RoystonSanctis/notion-components/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=RoystonSanctis/notion-components" />
</a>

## License

[MIT License](https://github.com/RoystonSanctis/notion-components/blob/main/LICENSE)

## Maintained By

Built and maintained for viaSocket Automation by [RoystonSanctis](https://github.com/RoystonSanctis)