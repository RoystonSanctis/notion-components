# Notion Components

A collection of reusable components for working with the **Notion API**.

This repository contains essential utilities used in **viaSocket Automation** to process, transform, and manipulate Notion content programmatically.

The goal of this project is to provide **reliable conversion tools between Notion blocks and various output formats**, making it easier to integrate Notion into automation pipelines, content workflows, and developer tools.

---

## Features

- Convert **Notion Blocks → Markdown**
- Convert **Notion Blocks → HTML**
- Preserve **rich text formatting**
- Handle **nested blocks**
- Support for all common Notion block types
- Graceful fallback for unsupported blocks
- Clean output
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

## Converters

### 1. Notion → Markdown

Converts a Notion API block array into a clean **Markdown** string.

📖 **[Full documentation → notionToMarkdown.md](./notionToMarkdown.md)**

```javascript
import notionToMarkdown from "./converters/notionToMarkdown.js"

const result = await notionToMarkdown(notionBlocks, {
  auth: "ntn_your_api_key"
})
console.log(result.markdownContent)
```

---

### 2. Notion → HTML

Converts a Notion API block array into a semantic **HTML** string.

📖 **[Full documentation → notionToHtml.md](./notionToHtml.md)**

```javascript
import notionToHtml from "./converters/notionToHtml.js"

const result = await notionToHtml(notionBlocks, {
  auth: "ntn_your_api_key"
})
console.log(result.htmlContent)
```

---

## Design Principles

- Clean output (Markdown and HTML)
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
│   ├── notionToMarkdown.js
│   └── notionToHtml.js
│
├── utils/
│
├── examples/
│
├── notionToMarkdown.md
├── notionToHtml.md
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