import { useLocation } from "@solidjs/router"
import * as Schema from "effect/Schema"
import { createMemo } from "solid-js"
import { Approvals } from "../features/approvals/approvals.tsx"
import { ApprovalStatus } from "../features/approvals/service.ts"
import { DecodedConnectedSessionRoute } from "./connected-route.tsx"
import { decodeRouteInput } from "./route-input.ts"

const RouteInput = Schema.Struct({ status: Schema.optionalKey(ApprovalStatus) })

export default function ApprovalsRoute() {
  const location = useLocation()
  const route = createMemo(() => decodeRouteInput(RouteInput, location.search, undefined))

  return (
    <DecodedConnectedSessionRoute
      route={route}
      invalidTitle="Invalid route"
      invalidDescription="Use only a request status filter."
      invalidHref="/approvals"
      invalidLink="Open Approvals"
      title="Approvals"
      description="Connect a valid session to decide approval requests."
    >
      {(route) => <Approvals status={route.status ?? "pending"} />}
    </DecodedConnectedSessionRoute>
  )
}
