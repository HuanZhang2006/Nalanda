# ADR-0007: Do not copy non-commercially licensed AI implementations without a commercial license

> **About this document**
> - **Contents**: Records the license boundary when third-party AI projects such as ExamPass-Assistant are used as references.
> - **Purpose**: Prevents Nalanda's market, VIP, and payment monetization from conflicting with non-commercial terms such as CC BY-NC.
> - **When to update**: When a third-party project's license changes, written commercial authorization is obtained, the implementation source is replaced, or new parsing/agent code is introduced.
> - **Legal note**: This is an engineering governance decision and does not replace professional legal advice.

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** Project maintainer
- **Scope:** AI parsing, prompts/agents, templates, and derived implementations

## Context

The architecture blueprint planned to borrow heavily from ExamPass-Assistant's parsing pipeline and multi-agent approach, while noting that its license is CC BY-NC 4.0. Nalanda's goals include paid AI, VIP, a content market, and creator revenue share, so directly copying or deriving code may not satisfy the non-commercial restriction.

## Decision

- Until the copyright holder grants explicit, written commercial authorization, do not copy, modify, package, or deploy code, templates, prompts, skills, or other copyrightable expression governed by a non-commercial license.
- The team MAY study publicly described general ideas, interface requirements, and industry practices, but production implementations should be written independently for Nalanda's needs by people who have not seen the restricted source, with design/implementation provenance kept on record.
- If authorization is obtained, the owner must review its scope, version, attribution, notice obligations, redistribution, and termination terms, and record it in the third-party inventory.
- Every new dependency or copied snippet must declare its source and license in the PR; "open source" or "visible on GitHub" does not mean commercial use is allowed.

## Consequences

This lowers intellectual-property and takedown risk, but increases independent implementation and evaluation cost and may slow AI progress. Until authorization is granted, blueprint wording such as "secondary development based on ExamPass" can only be read as a research goal, not as an implemented or directly reusable engineering plan.

## Gap between current implementation and target

- **Current production implementation:** The Materials parser, provider adapters, prompts, and validators from 0041–0043 are Nalanda's own implementation and copy nothing from the non-commercial project; third-party Python/Node dependencies must still be license-scanned at the merge gate.
- **Target:** Keep choosing only commercially compatible dependencies or clean rewrites, and add automated SBOM/license scanning, NOTICE/attribution, and code provenance review.

## Verification and review

AI implementation PRs must provide a dependency license and provenance list. Code whose provenance or authorization cannot be shown is not merged. When new authorization is obtained, record the outcome in a new ADR or as a status addendum to this one.
