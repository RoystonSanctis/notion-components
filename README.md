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
| code | Markdown code block |
| divider | `---` |
| toggle | Bold list item with nested content |
| callout | Quoted block with emoji |
| child_page | Page reference |
| link_to_page | Linked page reference |

Unsupported blocks are stored separately for further processing.

---

## Example Usage

```javascript
import notionToMarkdown from "./notionToMarkdown.js"

const result = notionToMarkdown(notionBlocks)

console.log(result.markdownContent)
console.log(result.unsupportedMarkdownBlocks)
```

**Output structure:**

```javascript
{
  markdownContent: "Converted markdown text",
  unsupportedMarkdownBlocks: []
}
```

## Function Overview

### notionToMarkdown(blocks)

Converts a Notion block array into Markdown.

#### Parameters

- **blocks**: `Array`
  The array of blocks returned from the Notion API.

#### Returns

```javascript
{
  markdownContent: string,
  unsupportedMarkdownBlocks: array
}
```

## Design Principles

- Clean Markdown output
- Preserve as much Notion structure as possible
- Never silently discard unsupported blocks
- Keep functions portable and dependency-free

## Planned Features

Upcoming utilities:

- Markdown → Notion block converter
- Notion rich text utilities
- Table conversion helpers
- Image and media block handling
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

If you want to improve support for additional Notion block types or add new converters, feel free to open a pull request.

## License

MIT License

## Maintained By

Built and maintained for viaSocket Automation.