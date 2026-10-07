# ER diagram (database schema draft)

Draft for Sprint 0 review. Renders on GitHub. Types are indicative; exact column types are decided in the first migration.

```mermaid
erDiagram
    USER {
        uuid id PK
        string email UK "domain-checked, lowercase"
        string name
        string password_hash
        enum role "STUDENT, POC, SUPER_ADMIN"
        string enrollment_id "students, from email local part"
        timestamp email_verified_at
        timestamp created_at
    }
    CATEGORY {
        uuid id PK
        string name UK "e.g. Hostel & Accommodation"
        string short_name "chip and team label, e.g. Hostel"
        int sort_order
        int max_level "highest escalation level"
        boolean active "retired categories are hidden, not deleted"
    }
    SUB_CATEGORY {
        uuid id PK
        uuid category_id FK
        string name "unique within its category"
        int sort_order
        boolean active
    }
    POC_ASSIGNMENT {
        uuid id PK
        uuid user_id FK
        uuid category_id FK
        int level "1, 2, 3..."
        uuid manager_assignment_id FK "the L(n+1) POC who oversees this one"
        boolean active
        boolean on_leave
    }
    TICKET {
        uuid id PK
        string title
        text description
        uuid category_id FK
        uuid sub_category_id FK "what exactly the issue is about"
        uuid student_id FK
        enum priority "LOW, MEDIUM, HIGH"
        enum status "CREATED, ASSIGNED, IN_PROGRESS, ESCALATED, RESOLVED, REOPENED"
        int current_level
        int resolved_level "set on resolve, used on reopen"
        uuid assigned_poc_id FK "nullable, internal only"
        timestamp tat_deadline
        boolean critical
        uuid parent_ticket_id FK "nullable, duplicate master"
        timestamp created_at
        timestamp updated_at
        timestamp resolved_at
    }
    TICKET_EVENT {
        uuid id PK
        uuid ticket_id FK
        enum type "CREATED, ASSIGNED, COMMENTED, STATUS_CHANGED, ESCALATED, TAT_BREACHED, NUDGED, RESOLVED, REOPENED, LINKED, UNLINKED"
        uuid actor_id FK "null for system"
        uuid assignee_id FK "who the ticket went to (ASSIGNED, ESCALATED, REOPENED)"
        enum from_status
        enum to_status
        int from_level
        int to_level
        enum visibility "PUBLIC, INTERNAL"
        text note "e.g. POC unavailable"
        timestamp created_at
    }
    TICKET_FEEDBACK {
        uuid id PK
        uuid ticket_id FK
        uuid student_id FK
        uuid finish_event_id FK "the Solved or Closed event answered; one answer per finish"
        enum rating "SATISFIED, OKAY, NOT_SATISFIED"
        text comment
        uuid finished_by_id FK "the POC credited"
        int finished_level
        uuid category_id FK
        timestamp created_at
    }
    COMMENT {
        uuid id PK
        uuid ticket_id FK
        uuid author_id FK
        uuid parent_comment_id FK "nullable, threading"
        text body
        enum visibility "PUBLIC, INTERNAL"
        timestamp created_at
    }
    COMMENT_MENTION {
        uuid comment_id FK
        uuid mentioned_user_id FK
    }
    ATTACHMENT {
        uuid id PK
        uuid ticket_id FK
        uuid comment_id FK "nullable"
        uuid uploader_id FK
        string storage_key "random object key"
        string file_name
        string mime_type
        bigint size_bytes
        enum scan_status "PENDING, CLEAN, INFECTED"
        timestamp created_at
    }
    NOTIFICATION {
        uuid id PK
        uuid user_id FK
        enum type "STATUS_CHANGE, COMMENT, MENTION, ESCALATION, RESOLVED, NUDGE, NEW_TICKET"
        uuid ticket_id FK
        uuid comment_id FK "nullable, deep link"
        timestamp read_at
        timestamp emailed_at "outbox: null until sent"
        timestamp created_at
    }
    REFRESH_TOKEN {
        uuid id PK
        uuid user_id FK
        string token_hash
        timestamp expires_at
        timestamp revoked_at
    }
    JOB_HEARTBEAT {
        string job_name PK
        timestamp last_run_at
    }

    USER ||--o{ POC_ASSIGNMENT : "has"
    CATEGORY ||--o{ POC_ASSIGNMENT : "staffed by"
    POC_ASSIGNMENT |o--o{ POC_ASSIGNMENT : "manages"
    USER ||--o{ TICKET : "raises (student)"
    CATEGORY ||--o{ SUB_CATEGORY : "contains"
    CATEGORY ||--o{ TICKET : "classifies"
    SUB_CATEGORY |o--o{ TICKET : "narrows"
    USER |o--o{ TICKET : "currently assigned (POC)"
    TICKET |o--o{ TICKET : "master of duplicates"
    TICKET ||--o{ TICKET_EVENT : "audit log"
    TICKET ||--o{ TICKET_FEEDBACK : "student feedback"
    TICKET_EVENT ||--o| TICKET_FEEDBACK : "answers"
    USER |o--o{ TICKET_EVENT : "performed"
    USER |o--o{ TICKET_EVENT : "received"
    TICKET ||--o{ COMMENT : "thread"
    USER ||--o{ COMMENT : "writes"
    COMMENT |o--o{ COMMENT : "replies"
    COMMENT ||--o{ COMMENT_MENTION : "tags"
    USER ||--o{ COMMENT_MENTION : "is tagged"
    TICKET ||--o{ ATTACHMENT : "has"
    USER ||--o{ ATTACHMENT : "uploads"
    USER ||--o{ NOTIFICATION : "receives"
    TICKET ||--o{ NOTIFICATION : "about"
    USER ||--o{ REFRESH_TOKEN : "owns"
```

## Design decisions

| Decision | Why |
| --- | --- |
| Two-level categories: `CATEGORY` (11 main, including "Other") and `SUB_CATEGORY` (57) | Students pick a topic then what exactly it is; POCs are assigned per main category, while analytics can drill into sub-categories. Retired categories are marked inactive because old tickets still point at them. |
| `role` is only STUDENT, POC or SUPER_ADMIN; level lives on `POC_ASSIGNMENT` | A POC's level and category can change without changing their account, and one person can in theory cover more than one category. |
| `manager_assignment_id` links an L1 assignment to its L2 | This is what lets an L2 see only the L1 team they oversee (the rollup and nudge features). |
| `assigned_poc_id` is on the ticket but never exposed to students | Students get a team label built from `category` and `current_level`. Student response models have no POC fields at all (NFR-02). |
| `TICKET_EVENT` is append-only with a `visibility` flag | Satisfies the audit requirement; INTERNAL events (nudges, "POC on leave" notes) are never selected by student queries. |
| `visibility` on `COMMENT` as well | Supports POC-to-POC internal comments hidden from the student. |
| `resolved_level` on the ticket | Reopen returns the ticket to the level that resolved it. |
| `NOTIFICATION.emailed_at` | Acts as the outbox: the worker sends pending notifications and stamps the time, so email can be added without changing ticket code. |
| `parent_ticket_id` | Duplicate linking: children mirror the master's status and level. |
| `ATTACHMENT.scan_status` | Files are not visible until the antivirus scan marks them CLEAN. |
| `JOB_HEARTBEAT` | The monitoring alert fires if the escalation job has not recorded a run in 15 minutes. |

## Indexes planned (NFR-17)

- `ticket(status, current_level, tat_deadline)` for the escalation job and POC dashboards
- `ticket(student_id, created_at)` for "My Tickets"
- `ticket(category_id, status)` for queues and analytics
- `ticket_event(ticket_id, created_at)` for timelines, `ticket_event(created_at)` for analytics date ranges
- `comment(ticket_id, created_at)`, `notification(user_id, read_at)`
- `pg_trgm` index on `ticket(title, description)` for duplicate suggestions

## Open points to confirm

1. Can one POC hold assignments in more than one category? The schema allows it.
2. Decided: students do not set `priority`. The column stays (default MEDIUM) for POCs to use later; students never send or see it.
3. Retention: how long are tickets, attachments and events kept?
