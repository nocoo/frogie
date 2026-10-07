<p align="center">
  <img src="assets/brand/icon-rounded.png" width="128" height="128" alt="Frogie Logo" />
</p>

<h1 align="center">Frogie</h1>

<p align="center">Design agent definitions centrally. Run them locally in the projects they serve.</p>

<p align="center">
  <a href="docs/">Documentation</a>
</p>

<p align="center">
  <a href="https://github.com/earendil-works/pi/tree/main/packages/durable"><img src="https://img.shields.io/badge/Foundation-Pi%20Durable-557A46" alt="Foundation: Pi Durable" /></a>
  <img src="https://img.shields.io/badge/Status-Design%20Stage-8A6D3B" alt="Status: Design Stage" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
</p>

## What It Is

Frogie is being designed as a central authoring workspace and shared integration layer for projects that use [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable) to run local agents.

As more projects adopt agents, each can grow its own vocabulary, role configuration, conversation management, and recovery glue. Frogie aims to make those foundations consistent without making different businesses follow the same workflow.

Users will define and organize roles, prompts, skills, and collaboration arrangements in one interface. Consuming projects will load versioned definitions, supply their business tools, and own their local execution and state. The authoring workspace is not a central execution service.

## Intended Capabilities

These are product goals, not implemented features.

- **A shared view across projects**: understand roles, responsibilities, collaboration, model choices, and allowed tools through a consistent vocabulary.
- **Portable definitions**: organize structured Markdown files for prompts, skills, and workflows, with referenced scripts kept as source files.
- **Two guidance modes**: let agents choose their approach freely, or provide a documented flow with expected inputs, outputs, and handoffs. A documented flow guides the model; it does not guarantee compliance.
- **Reusable Pi integration**: share definition loading and runtime wiring while preserving Pi Durable's conversations, submissions, tasks, extensions, and storage semantics.
- **Local, sandboxed execution**: run project work near local files, tools, and compute, with enforced capability boundaries rather than prompt-only restrictions. Sandbox support remains to be implemented.

## Project Boundaries

| Concern | Owner |
| --- | --- |
| Definition authoring, organization, and common integration code | Frogie |
| Business tools, authentication, triggers, UI integration, and mandatory business rules | Consuming project |
| Durable execution primitives and committed state | Pi Durable, hosted by the consuming project |
| Conversations, SQLite state, credentials, and execution artifacts | The project's local runtime, not the authoring workspace |

Definitions may describe capabilities, but cannot grant permissions beyond what the consuming project authorizes. Workflow guidance does not replace tool restrictions, sandbox isolation, or business approval gates.

Local execution does not require local model inference: model calls may use a remote provider or a compatible local service. Closing the authoring interface must not stop an independently running project.

## Development Status

The previous application has been removed. This repository currently contains positioning documentation, the MIT license, and the preserved logo artwork and generation assets. There is no runnable application, installable runtime package, or application build/test command yet.

Implementation choices and integration contracts will be documented separately. The existing [logo documentation](docs/logo.md) explains the preserved identity and derivative generation.

## References

- [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable): the execution foundation, not a framework to replace.
- [his.fm](https://github.com/nocoo/his.fm): a local resident coordinator that dynamically delegates to specialist conversations.
- [Giraffe](https://github.com/nocoo/giraffe): a local, host-directed process that uses model conversations for analysis, planning, execution, and review.

The two applications are reference implementations, not existing Frogie consumers. Their different business control models should remain possible on a common foundation.

## Documentation

Project documentation lives under [docs/](docs/). New design documents use numbered filenames; the preserved logo reference remains unnumbered.

- [Logo identity](docs/logo.md): original artwork, provenance, and derivative generation.

## License

[MIT](LICENSE)
