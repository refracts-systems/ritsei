import { useLocation, useParams } from "@solidjs/router"
import * as Schema from "effect/Schema"
import { createMemo } from "solid-js"
import { Billing } from "../../features/billing/billing.tsx"
import { DecodedConnectedSessionRoute } from "../connected-route.tsx"
import { decodeRouteInput } from "../route-input.ts"

const RouteInput = Schema.Struct({
  id: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
  legalEntityId: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
  side: Schema.optionalKey(Schema.Literals(["receivable", "payable"])),
})

export default function BillingRoute() {
  const location = useLocation()
  const params = useParams<{ id?: string }>()
  const route = createMemo(() => decodeRouteInput(RouteInput, location.search, params.id))

  return (
    <DecodedConnectedSessionRoute
      route={route}
      invalidTitle="Invalid route"
      invalidDescription="Use a valid document ID, legal entity ID, and side."
      invalidHref="/billing"
      invalidLink="Open Billing"
      title="Billing"
      description="Connect a valid session to view billing documents."
    >
      {(route) => (
        <Billing
          selectedDocumentId={route.id}
          legalEntityId={route.legalEntityId}
          side={route.side}
        />
      )}
    </DecodedConnectedSessionRoute>
  )
}
