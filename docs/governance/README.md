# Governance Documentation Index

> **About this document**
> - **Contents**: Collects Nalanda's governance standards for personal data, content, moderation, incidents, and long-term operational responsibility.
> - **Purpose**: Gives product, engineering, support, security, and operations one entry point, and keeps policy goals separate from current technical capability.
> - **When to update**: When a governance area is added, a policy owner or process changes, target markets or regulations change, or a document in this index is renamed.
> - **Status baseline**: 2026-07-10; a governance requirement does not mean a matching back office or automation already exists.

| Document | Responsible for | Current implementation summary |
|---|---|---|
| [Privacy and data deletion](PRIVACY_AND_DATA_DELETION.md) | Data classification, access/export/deletion, retention, backups, and third-party processing | Partly relies on Supabase RLS; no complete DSAR/deletion orchestration |
| [Content moderation](CONTENT_MODERATION.md) | Prohibited content, reports, enforcement, appeals, copyright, and transparency | Community CRUD exists; no reporting/moderation back office or state machine |

Governance documents define the behavior the product and operations must achieve; actual capability is evidenced by code, migrations, and executable tests. When adding a rule, also name the owner, data model/API, observability metrics, user notifications, appeal/correction path, and launch gate.
