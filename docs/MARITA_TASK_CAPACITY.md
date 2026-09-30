# Marita task capacity

Prospects added through `/api/prospecting/push` are scheduled from the next Cairo business day (Sunday through Thursday). All open Marita tasks count, including follow-ups and retries. The cap is 70 tasks per day. Up to ten slots are reserved for Elevatus research inside that total. Existing work due today or earlier consumes forecast capacity first. Existing CRM due dates are never changed by this scheduler.

The source must identify `Elevatus` for the new task to use those reserved slots. Its title is prefixed with `Elevatus`. The API returns `scheduledAt` so callers can display the actual due date. Other owners retain their current routing behavior.

## Concurrent requests and failed writes

The existing persistent `/app/data` volume stores a reservation journal. An exclusive directory lock serializes allocation across processes sharing that volume. Reservations count before HubSpot Search has indexed a new task. A failed or timed-out POST keeps its reservation: the next request cannot silently create another task for that company or contact.

After a worker crash, a remaining lock pauses automatic allocation. An operator must establish that no worker is active and reconcile the reserved contact/company against HubSpot before removing a stale lock. Likewise, an uncertain reservation must be matched to an actual HubSpot task or confirmed not created before it is corrected. Do not erase the journal or release reservations solely because a timeout elapsed.

## Scope

This control covers the existing daily phone-first workflow and other callers of `/api/prospecting/push`. Manual CRM changes and other write endpoints can still change a day's workload. This change does not rebalance old tasks, transfer ownership, delete tasks, or validate a company's sales eligibility. Existing account qualification remains required before pushing a prospect. If protected follow-ups alone exceed the cap, review the workload rather than moving promised dates automatically.

Deploy through the normal main CI and `deploy-hostinger.yml` path. Verify the production build reference and a separately approved eligible prospect's returned `scheduledAt` before declaring the live integration verified.
