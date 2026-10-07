# 01 - Project Positioning

Status: Draft for review

Date: 2026-10-08

This document captures Frogie's product direction and boundaries. It is not an implementation plan, a definition-file specification, or a claim that the described capabilities already exist. The previous application has been removed; implementation has not started.

## Purpose

Frogie gives projects a common way to define, understand, and integrate local agents built on Pi Durable, without requiring those projects to share the same business or execution strategy.

Its central principle is:

> Centralize the understanding and maintenance of agent definitions. Keep execution, authority, and runtime state with the projects those agents serve.

Frogie combines a user-facing authoring workspace with reusable integration code. These are complementary responsibilities, not a requirement for one central service to run every project's agents.

## The Problem

Adding an agent to one project often requires more than prompts: role configuration, conversation selection, tool registration, input delivery, result handling, and recovery integration. Repeating that work across many projects creates independently evolving implementations of the same mechanisms.

At two projects, the differences can be remembered. At ten or twenty, users and developers must learn a different vocabulary and operating model for each project. Shared fixes become repeated work, definitions become difficult to compare, and it becomes unclear which capabilities a project actually exposes.

Not every difference is a defect. An interactive editorial assistant and a scheduled repository-maintenance process should make different business decisions. Frogie must reduce accidental divergence in their foundations without removing intentional differences in their behavior.

The goal is not a universal agent that understands every business. It is a common foundation that makes different agents understandable and maintainable.

## Product Identity

### A central authoring workspace

Users should be able to organize agent definitions across projects through one interface. For each definition, they should be able to understand:

- The roles involved and the responsibilities assigned to each role.
- The prompts, skills, scripts, models, and thinking levels those roles use.
- The permitted collaboration relationships and declared tool requirements or restrictions.
- The intended inputs, outputs, and optional workflow guidance.
- The identity and revision of the definition a project is expected to consume.

The durable output of authoring is a portable collection of structured Markdown files and referenced source assets. The interface must not be the only place where definitions can be read or maintained. Scripts remain executable source files associated with skills, rather than being treated as prose alone.

The authoring workspace stores definitions, not project conversations, execution histories, or recovery checkpoints. A user-managed definition workspace is distinct from Frogie's own source repository; private project definitions do not need to become part of Frogie's codebase.

### A shared integration foundation

Consuming projects should reuse the code that loads definitions and connects them to Pi Durable. They should not each rebuild the same conversation, submission, tool-selection, and recovery wiring.

That code executes in the consuming project's local runtime. Shared code ownership does not imply shared process ownership, shared SQLite storage, or a shared account with access to every project.

Projects continue to provide their business capabilities and enforce their own authority. A project may use a model coordinator, a host-directed process, or both. Adding a conversational coordinator must not require replacing an existing deterministic business process.

## Relationship to Pi Durable

Pi Durable is the execution foundation, not a backend hidden behind a competing agent framework.

Frogie must work with its existing concepts: Harness, conversations, per-conversation Agent configuration, submissions, durable tasks, extensions, documents, and storage. It should translate authoring definitions into those mechanisms rather than introduce a second scheduler, transcript store, or recovery engine.

A role is a reusable definition, not a Pi conversation. One role may be applied to multiple conversations. A submission admits input; a run may involve multiple generation and tool tasks. Saving a role's prompt does not save the execution state of its instances.

Frogie's integration surface should remain compatible with project-supplied Pi tools, extensions, hooks, and documents. A project-specific capability should not require abandoning the shared foundation simply because it cannot be described entirely in Markdown.

## The Definition Vocabulary

These terms describe the intended authoring model. They do not introduce new Pi runtime primitives or prescribe a file schema.

| Term | Meaning | Boundary |
| --- | --- | --- |
| Role | A reusable responsibility, instructions, skills, model preferences, and capability requirements | Not a live process or conversation; can have multiple instances |
| Skill | Reusable instructions and related resources, including optional scripts | Does not grant permissions merely by being loaded |
| Workflow | Guidance describing intended steps, roles, inputs, outputs, and handoffs | Not a guaranteed execution graph or deterministic state machine |
| Squad | A composition of roles and their intended collaboration relationships | Does not require a model coordinator or replace task ownership |
| Agent service | A consuming project's local runtime that loads definitions and handles project work | Owns its execution state and authenticates to its project independently |

Prompt and skill content describe how an agent should act. Tool implementations, runtime permissions, and business rules determine what it can actually do. Neither is a substitute for the other.

## Guidance Modes

Frogie should support two modes on the same Pi execution foundation:

| Mode | Definition provides | Execution expectation |
| --- | --- | --- |
| Free-form | Goals, role responsibilities, skills, and allowed capabilities | The agent chooses how to approach the work |
| Flow-guided | The same foundation plus documented steps and expected inputs, outputs, and handoffs | The agent is instructed to follow the flow |

A flow is expressed as instructions, not a promise. Frogie does not guarantee that an agent follows every step, nor is detecting and correcting semantic workflow drift part of this positioning. Definition validity and reference checks are different from proving execution compliance.

Markdown may describe input/output contracts and serve as a format for working documents. Actual inputs, generated outputs, and progress belong to the consuming project's execution context, not to the definition source.

This flexibility does not weaken security or mandatory business rules. An agent may deviate from suggested steps, but may not acquire extra tools, bypass the sandbox, or authorize publication simply because its prompt asks for it. A business that requires a hard gate must enforce that gate in code.

## Responsibility Boundaries

| Owner | Responsibility |
| --- | --- |
| Frogie authoring workspace | Edit, organize, inspect, and export role, skill, squad, and workflow definitions |
| Frogie integration code | Resolve definitions, connect them to Pi, and provide reusable runtime and capability-enforcement wiring |
| Pi Durable | Supply the durable execution, conversation, task, document, and observation primitives |
| Consuming project | Supply business tools, authentication, triggers, input/output delivery, UI integration, and mandatory business rules |
| Project's local runtime | Own runtime configuration, SQLite state, execution artifacts, process lifecycle, and the authorized execution environment |

Tool identifiers in a definition are references, not implementations or credentials. The consumer must supply or explicitly register the relevant capabilities. Definition restrictions and consumer authorization both apply; a definition cannot widen what the consumer permits.

Common integration should reduce repetitive code, not claim that a new business can always be implemented without code. Authentication scope, domain validation, and external effects remain real responsibilities even when most agent behavior is authored as text.

## Local Execution and Trust

Local execution is a product requirement: project agents should use local files, tools, compute, and working environments rather than depend on a centrally hosted execution service.

Agent-invoked project code and skill scripts must run through an actual local sandbox boundary. Separate conversations or working directories are not OS isolation. Pi's execution-environment abstraction provides an integration point, but does not make the default Node environment a sandbox.

Custom tools require the same scrutiny. Sandboxing a shell tool does not isolate another tool that directly launches an unrestricted host process. Trusted host-side business adapters must enforce their own resource and API scopes.

Local agents connect to their project's services through explicit authentication and authorization. The design workspace is not a shared credential authority, and definition files must not contain model or project secrets. Machine-specific credentials and authorized resources are supplied at runtime.

Local execution also does not imply local model inference. A project may use remote inference or a compatible local model service. The sandbox mechanism, supported platforms, and authentication protocols are subsequent design decisions, not capabilities already delivered by this repository.

## Ownership of Definitions and State

The following boundaries must remain visible regardless of the eventual directory layout or distribution mechanism:

- **Definition source**: versioned Markdown and script assets with a clear authoritative editing location. This may be a shared definition workspace or a project-owned directory managed through Frogie.
- **Consumer binding**: the project selects the definition revision and supplies tool implementations, model connections, and local permissions. Editing a definition must not silently change the meaning or authority of already-running work.
- **Runtime state**: conversations, submissions, task progress, results, receipts, and recovery data remain with the consuming project through Pi and any necessary business storage.
- **Private machine configuration**: credentials and machine-specific settings remain outside portable definitions and their version history.

Recovery needs the relevant definition and executable implementations as well as saved state. Definitions alone cannot reconstruct completed side effects or in-flight work. Pi's replay mechanisms do not eliminate a business tool's responsibility for idempotency and reconciliation.

Closing Frogie's authoring interface must not stop a consumer that has already loaded its definitions. The interface must not become a required participant in each model turn or tool call.

## A Central View Without Central Execution

The central channel should make many different projects understandable through the same questions and vocabulary. It need not understand every internal business operation. An opaque project-owned capability can still expose its purpose, inputs, outputs, and authority boundaries without becoming a Frogie-specific workflow graph.

Three views must not be confused:

1. **Designed structure**: what a definition says should exist. This is the authoring workspace's primary responsibility.
2. **Loaded configuration**: what a project has actually loaded. This requires evidence from the consumer, not inference from the latest definition file.
3. **Current execution**: what a runtime is doing now. This requires connecting to that runtime and is not part of definition storage.

If runtime inspection or a generic chat entrypoint is later exposed in the central interface, the consumer remains authoritative for authentication, permitted entrypoints, conversations, and history. Such access must not silently turn the authoring workspace into a second execution database or bypass project permissions. This document does not commit to a runtime-monitoring feature or protocol.

## Reference Projects

These references establish the problem and useful capability boundaries. They are not existing Frogie consumers, and neither application's current implementation is a specification to copy wholesale.

### Pi Durable: execution foundation

[Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable) is a durable agent harness built on Pi's model access and committed document state. Its conversations, tasks, tool execution, and recovery mechanisms provide the foundation Frogie intends to reuse.

The initial investigation examined version `1.0.0`, pinned by both reference applications. That evidence does not establish compatibility with every later release. Pi's documentation and public types, rather than assumptions borrowed from a CLI product, define the integration boundary.

### his.fm: interactive, model-directed coordination

[his.fm](https://github.com/nocoo/his.fm) connects a local resident agent runtime to an editorial application. A coordinator conversation receives user intent and dynamically delegates to writer, reviewer, and speech conversations. The host controls available tools, persists assignments, and validates completion evidence and application receipts.

Its editable prompt catalogue demonstrates that behavior definitions can be separated from the execution machinery. Its runtime demonstrates that dynamic delegation still needs durable identities, explicit capability selection, and host-owned business checks.

Reference revision: `36d1d3b0e86d828508b11826964d40cc566789f1`.

- [Prompt catalogue and code-owned boundaries](https://github.com/nocoo/his.fm/blob/36d1d3b0e86d828508b11826964d40cc566789f1/docs/prompts.md).
- [Local coordinator, delegation, and result handling](https://github.com/nocoo/his.fm/blob/36d1d3b0e86d828508b11826964d40cc566789f1/packages/agent/src/runtime.ts).

### Giraffe: host-directed work with model participants

[Giraffe](https://github.com/nocoo/giraffe) runs a local scheduled repository-maintenance process. Model conversations contribute analysis, planning, implementation, and independent review, while host code controls the legal execution sequence, checks, publication authority, and recovery checkpoints.

It does have coordination: a host coordinator and a model planning conversation. It does not use the same continuously interactive model coordinator as his.fm. That difference should remain valid after shared integration is introduced.

Its implementation demonstrates that common conversation configuration, structured results, and durable state can support a business process whose important ordering and approval rules remain in code. Converting those rules into advisory Markdown would change its guarantees, not merely extract reusable definitions.

Reference revision: `ed06d4a774e43f17e2510b06c849f2bcac2b6843`.

- [Conversation configuration and validated results](https://github.com/nocoo/giraffe/blob/ed06d4a774e43f17e2510b06c849f2bcac2b6843/packages/agent/src/work-conversations.ts).
- [Host-directed coordination](https://github.com/nocoo/giraffe/blob/ed06d4a774e43f17e2510b06c849f2bcac2b6843/packages/agent/src/work-coordinator.ts).

Both applications currently execute native tools as the local user without an OS sandbox. They demonstrate local integration patterns, not fulfillment of Frogie's sandbox requirement. Neither currently provides the complete portable role/skill/workflow definition system described here.

## Non-Goals

- Replacing Pi Durable with a new scheduler, agent loop, or durable execution model.
- Running every project's agents in one mandatory central process or storing their execution histories in the authoring workspace.
- Requiring every project to use a model coordinator or the same business workflow.
- Guaranteeing that an agent follows prose instructions, or turning advisory workflows into a deterministic orchestration language.
- Treating prompts as permissions, definitions as credentials, or local execution as automatic isolation.
- Requiring domain-specific behavior to fit a universal no-code schema before it can use the shared runtime integration.

## Success Criteria

Frogie succeeds when a twentieth project can add agents without introducing a twentieth vocabulary or reimplementing the same Pi integration, while still delivering behavior the first nineteen projects never needed.

Users should be able to understand definitions and capability boundaries centrally. Developers should be able to reuse common mechanisms and retain direct access to Pi's extension points. Consumers should continue to execute independently with their own authority and durable state.

File schemas, package boundaries, UI layout, distribution/version selection, sandbox technology, and migration of the reference projects remain for subsequent numbered documents. This positioning fixes the purpose and ownership boundaries without prematurely fixing those implementation choices.
