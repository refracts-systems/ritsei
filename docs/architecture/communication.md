# RITSEI Communication Platform Architecture

> **Status:** Canonical target architecture; memory-only vertical slice
>
> **Owns:** Communication intent, recipient/context/template boundaries, channel message contracts,
> immutable communication artifacts, delivery-attempt semantics, and timeline projection rules.
>
> **Does not own:** Business facts, domain lifecycle, workflow authority, document meaning, provider
> credentials, SMTP/SES APIs, or a universal notes/attachments/audit table.
>
> **Related documents**
>
> - Runtime architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Messaging and transactional outbox: [`./pgque-messaging.md`](./pgque-messaging.md)
> - Durable execution: [`./durable-execution.md`](./durable-execution.md)
> - Document artifacts: [`./document-rendering.md`](./document-rendering.md)
> - External integrations: [`./integration-architecture.md`](./integration-architecture.md)
> - Process Runtime: [`./process-studio.md`](./process-studio.md)
> - P3 audit and delivery boundary:
>   [`../decisions/0037-define-p3-audit-event-and-delivery-boundary.md`](../decisions/0037-define-p3-audit-event-and-delivery-boundary.md)
> - Messaging ownership:
>   [`../decisions/0038-move-internal-event-delivery-to-messaging.md`](../decisions/0038-move-internal-event-delivery-to-messaging.md)
> - Communication boundary decision:
>   [`../decisions/0082-adopt-communication-platform-boundaries.md`](../decisions/0082-adopt-communication-platform-boundaries.md)

## 1. Position

RITSEI treats email as one channel of a Communication Platform, not as a direct business-side
 effect and not as the business domain's provider wrapper.

```text
Business Domain
      ↓
Business Fact or explicit application/process request
      ↓
Transactional Outbox / command boundary
      ↓
Communication Policy
      ↓
Communication Intent
      ↓
Recipient + Policy + Context + Template
      ↓
Channel Message Model
      ↓
Rendered Communication Artifact
      ↓
Delivery Attempt
      ↓
Transport Adapter
      ↓
Provider
      ↓
Canonical Delivery Event
```

Business domains say **what happened** by emitting business facts. Application-level communication
policies may derive `CommunicationIntent` from those facts, while an explicit user or process request
may create an intent directly. Business domains do not depend on communication channels, templates,
recipients, transports, or providers. The Communication Platform resolves **who**, **which message**,
**which channel**, and **how delivery is tracked** without changing the business fact that caused it.

## 2. SAP-style internal separation, Odoo-style projection

Internally, RITSEI follows a SAP-like capability split:

```text
Business Object
│
├── Domain Events
├── Audit Evidence
├── Status History
├── Notes / Conversation
├── Attachments
├── Workflow / Tasks
├── Document Artifacts
└── Communications
```

The backend must not become one `chatter_messages` table that mixes notes, audit, workflow,
attachments, document output, and provider delivery. Each concern keeps its owner, invariants,
retention, and correction rules.

The user-facing Activity Timeline may combine those facts:

```text
Purchase Order PO-2026-1042

13:02  Ricky created PO
13:10  Maya changed quantity 10 → 12
13:11  quotation.pdf attached
13:30  Approval requested
13:44  Manager approved
14:01  PDF generated
14:02  Email queued
14:03  Email delivered
14:15  Ricky added a note
```

The timeline is a rebuildable read projection. It is not the communication execution model, an
 audit authority, or a replacement for Workflow, Document, Messaging, or domain-owned history.

## 3. Ownership boundaries

| Concern | Owner |
| --- | --- |
| Business state, lifecycle, authorization, corrections | Owning domain such as Sales, Procurement, Accounting, or Inventory |
| Domain facts and transactional publication | Owning domain plus `framework/modules/messaging` |
| Communication-intent derivation and delivery lifecycle | Application communication policy plus the Communication capability, behind public contracts |
| Recipient resolution and actual recipient snapshot | Communication capability and tenant-scoped resolver |
| Template selection and context version | Communication capability; template ownership remains a separately approved configuration boundary |
| HTML/plain-text message rendering | Channel renderer behind the communication port |
| Document meaning and immutable PDF artifact | Owner-local Document Platform contract and owning domain |
| Workflow approvals and assignments | Process Runtime / owning workflow capability |
| Provider protocols, credentials, webhooks | `framework/modules/integrations` or approved provider adapters |
| Activity Timeline | Rebuildable query projection; never authoritative |

`framework/foundation/communication` contains renderer- and provider-neutral contracts and Effect ports.
The first policy/delivery vertical slice lives in `erp/modules/communication` and is memory-only. Neither
layer owns a database schema, business aggregate from another domain, provider credential, or generic
mutable communication table. A future durable implementation must receive an explicit schema owner
before adding persistence.

## 4. Communication Intent

The primary semantic primitive is `CommunicationIntent`, not `Email`.

```text
purchase-order-approved
invoice-issued
invoice-overdue
workflow-approval-requested
account-invited
security-notification
```

An intent contains tenant scope, an owner-local subject reference, source-event identity, semantic
audience, requested channels, priority, locale/timezone hints, correlation, and an idempotency key.
It does not contain SMTP, SES, HTML, provider IDs, or arbitrary recipient addresses.

An application communication policy may derive an intent from `InvoiceIssued`:

```text
InvoiceIssued
  ↓
communication policy
  ↓
invoice-issued intent
  ↓
BillingContact(invoice.customer)
  ↓
email policy
  ↓
versioned template + context
```

An explicit request follows a separate application path:

```text
User or process clicks "Send invoice again"
  ↓
RequestCommunication
  ↓
CommunicationIntent
```

One domain event may produce multiple intents. Domain event names remain independent of channel names:
`InvoiceIssued`, not `InvoiceIssuedEmail` or `InvoiceIssuedSMS`.

## 5. Transactional outbox

Automatic communication follows the existing Messaging boundary in two idempotent transactions:

```text
BEGIN
  issue invoice
  append InvoiceIssued through Messaging
COMMIT

outbox consumer
BEGIN
  derive CommunicationIntent through communication policy
  persist intent idempotently
COMMIT
```

The first transaction proves that business truth and its committed fact are atomic. The second
transaction proves durable policy derivation without making the business domain depend on channels,
templates, recipients, or providers. An explicit `RequestCommunication` command may create an intent
directly through its own authorized, idempotent command transaction. The worker, renderer, or provider
must never be called synchronously from the business transaction.

The current implementation includes only a memory-only Procurement purchase-order confirmation
policy/delivery slice. No communication outbox table, worker, or provider dependency is added by this
slice. When persistence is introduced, it must use the existing Messaging/PgQue/job semantics, not a
fourth workload class or an unbounded promise fan-out.

## 6. Logical communication and delivery attempts

A logical `Communication` is separate from each provider call:

```text
Communication #123
│
├── Attempt #1 → temporary provider failure
├── Attempt #2 → accepted
└── Provider event → delivered
```

The logical record binds:

```text
communication_id
tenant_id
intent_type
subject
audience
channels
status
recipient_snapshot
template reference
context reference
communication artifact reference
```

An attempt binds attempt number, provider, provider message ID, status, failure classification, and
timestamps. Retrying creates another attempt for the same logical communication; it does not create a
new business notification or re-render by default.

`ACCEPTED`, `DELIVERED`, `BOUNCED`, `REJECTED`, and `COMPLAINED` are distinct external states.
`UNKNOWN` belongs to a `DeliveryAttempt`, not to the final state of the logical `Communication`.
Provider acceptance never proves recipient delivery. An unknown attempt moves the logical
communication into `reconciling` (or keeps it operationally pending) until a canonical provider
event or explicit manual recovery resolves the uncertainty.

## 7. Idempotency and retry

The logical idempotency identity is derived from stable business semantics:

```text
tenant_id + intent_type + intent_idempotency_key
```

A retry of the same event and logical intent must not create another communication. Provider calls
have their own provider idempotency identity and attempt state. These identities remain separate
from lease/fencing generations.

Retry policy is delivery-owned:

```text
temporary failure / timeout / rate limit → bounded retry with backoff and jitter
invalid address / hard bounce / policy rejection → no automatic retry
unknown outcome → reconcile before resubmission
```

The platform must not claim exactly-once external delivery. It provides durable idempotent intent and
attempt handling.

## 8. Recipient resolution and snapshots

Business domains use semantic audiences:

```text
BillingContact(customer)
SupplierOrderContact(supplier)
WorkflowAssignee(workflow)
AccountOwner(account)
TenantAdministrator(tenant)
```

A resolver produces an immutable `RecipientSnapshot` containing both the logical audience and the
actual mailbox addresses used. Audit can therefore answer both:

```text
Who was intended?
Which addresses were actually used?
```

Recipient resolution is tenant-scoped and versioned. A later contact change does not rewrite the
recipient snapshot of a historical communication.

## 9. Context and template versioning

Templates receive a validated, minimized `CommunicationContext`:

```text
invoice-issued-context-v1

company.name
customer.name
invoice.number
invoice.issueDate
invoice.dueDate
invoice.total
invoice.currency
document.downloadUrl
support.email
```

The context contains no database client, ORM object, repository, secret, filesystem capability,
network capability, or arbitrary JavaScript. Context contracts are versioned independently from
internal domain tables and services.

Template selection stores:

```text
template_id
template_version
context_type
context_version
locale
```

Resolution may fall back from tenant template to approved industry/default template, but the selected
version is always recorded. Template history is immutable; editing creates a new version.

## 10. Message Model and email AST

HTML is an output format, not the canonical representation. Email authoring uses a bounded,
channel-specific message model:

```text
Email Message
├── preheader
├── heading
├── text
├── image
├── key/value section
├── table
├── CTA button
├── divider
└── spacer
```

The contract is `EmailMessageNode` → HTML renderer plus plain-text renderer. The email design system
uses email-specific primitives and does not reuse interactive web primitives such as dialogs, tabs,
popovers, drag handles, or tooltips.

Shared communication primitives are limited to intent, context, recipient snapshot, artifact, and
delivery-attempt contracts. Each channel owns its message model:

```text
CommunicationIntent
       ↓
Channel compiler
   ├── EmailMessageNode
   ├── SmsMessage
   ├── PushMessage
   └── WhatsAppMessage
```

RITSEI deliberately does not define a universal `MessageAST`; email layout capabilities must not
become a lowest-common-denominator contract for channels with different semantics.

A raw HTML template may exist only as a compatibility escape hatch. It must be isolated, explicitly
classified, sanitized/validated, and never become the default authoring model. Arbitrary tenant
JavaScript, remote code, filesystem access, internal network access, and process execution remain
forbidden.

## 11. Email artifact and existing document artifacts

Rendering produces an immutable `CommunicationArtifact` containing the selected template/context
versions, subject, HTML/plain-text outputs, content hashes, renderer version, and attachment
references.

Attachments reference an existing immutable Document Platform artifact:

```text
InvoiceIssued
      ├── Document Platform → invoice.pdf artifact
      └── Communication Platform → attach documentArtifactId
```

The email subsystem must not re-render an invoice PDF. The same document artifact may be used for
download, email, print, archive, and audit. Attachment policy may choose an attachment, secure
expiring link, authenticated link, or deep link based on size and sensitivity.

## 12. Renderer and transport boundaries

The email renderer converts a validated message model into HTML and plain text. It does not send
mail. `EmailTransport` accepts a prepared email and returns a typed delivery receipt or stable
transport failure.

Provider adapters may implement SMTP, SES, Postmark, Resend, or an enterprise gateway. Provider
credentials, quotas, provider message IDs, response payloads, webhook signatures, and retry details
remain below the transport/integration boundary.

Provider webhooks follow this evidence path:

```text
Provider Webhook
      ↓
Opaque raw provider evidence
      ↓ verify signature and retain access-controlled evidence
Canonical Delivery Event
      ↓
Communication / DeliveryAttempt update
```

Raw evidence may be retained by the integration owner with opaque storage, access control, bounded
retention, and a content hash. Upstream communication contracts receive only the canonical delivery
event and an optional evidence reference; raw provider semantics do not leak into domain contracts.

Tenant sender identity and transport policy are resolved separately from templates. Domain
verification, SPF, DKIM, DMARC, reply-to policy, and provider credentials are infrastructure or
integration concerns, not template inputs.

## 13. Activity Timeline projection

The Activity Timeline is a **federated business projection** over source-specific records:

```text
Domain Events ────────┐
Audit Events ─────────┤
Status History ───────┤
Notes ────────────────┤
Attachments ──────────┤
Workflow Runs ────────┤
Document Artifacts ───┼──→ Activity Timeline projection
Communications ───────┤
Delivery Attempts ────┘
```

Timeline entries retain source owner, source identity, tenant scope, event time, actor/correlation
metadata, and a link back to the owning read contract. They do not copy enough data to become a
second business authority, and timeline freshness never proves current authorization or delivery.

Notes, attachments, audit records, workflow runs, document artifacts, and communication attempts
remain separate capabilities even when the UI presents them together.

## 14. Security, tenancy, and localization

Every communication resource is tenant-scoped:

```text
template
context
recipient policy
sender identity
transport policy
asset
artifact
attempt
```

Tenant A cannot select Tenant B's template, sender, transport, artifact, or asset. Contexts are
minimized and sensitive data is not copied merely for convenience. Provider credentials stay in a
secret store and never enter context or template evaluation.

Locale and timezone are explicit context inputs. Formatters use declared locale/timezone policy,
never the worker machine's implicit timezone. Transactional/legal communication may override optional
preferences according to an owner-approved policy.

## 15. Transactional versus campaign communication

Transactional communication and marketing campaigns are separate capabilities:

```text
Communication Platform
├── Transactional
│   ├── accounting
│   ├── procurement
│   ├── workflow
│   ├── security
│   └── system
└── Campaign
```

Campaigns have different consent, segmentation, suppression, scheduling, analytics, and retention
semantics. They must not share a transactional `Communication` lifecycle merely because both use
email.

## 16. Workload and observability

Communication rendering and delivery are bounded asynchronous work. They use queue backpressure,
per-provider rate limits, bounded concurrency, priority lanes, retry budgets, and worker isolation
from HTTP, document rendering, and Process Runtime resources. Communication is never a mandatory
synchronous dependency of source-of-truth reads or writes; provider, queue, renderer, and artifact
failures remain local to the communication capability. See ./workload-isolation.md
and [ADR-0083](../decisions/0083-enforce-non-interference-between-source-of-truth-and-derived-capabilities.md).

Useful metrics include:

```text
communication_created_total
communication_render_duration_ms
communication_queue_wait_ms
email_send_success_total
email_send_failure_total
email_retry_total
email_bounce_total
email_complaint_total
email_delivery_latency_ms
```

Labels remain bounded: communication type, channel, provider, tenant tier, and result. Email
addresses, invoice numbers, and communication IDs are not metric labels.

## 17. Current implementation boundary

This implementation slice adds renderer/provider-neutral contracts under `framework/foundation/communication`
plus a memory-only Procurement purchase-order confirmation policy under `erp/modules/communication`. It
does not add:

- a communication database schema or migration;
- a generic `chatter_messages` table;
- an SMTP/SES/provider dependency;
- an email worker or production delivery route;
- campaign/marketing behavior;
- a global Activity Timeline table;
- arbitrary HTML/JavaScript execution;
- direct domain-to-provider calls.

Future durable implementation must add the smallest owner-local persistence boundary, transactional
outbox integration through `framework/modules/messaging`, bounded jobs, idempotent delivery attempts, provider
adapters, webhook normalization, retention, and operational evidence in separate decisions.
