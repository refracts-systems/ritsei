import { useLocation, useParams } from "@solidjs/router"
import * as Schema from "effect/Schema"
import { createMemo } from "solid-js"
import { Settlement } from "../../features/settlement/settlement.tsx"
import { DecodedConnectedSessionRoute } from "../connected-route.tsx"
import { decodeRouteInput } from "../route-input.ts"

const Id = Schema.String.check(Schema.isUUID())
const CalendarDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))

const RouteInput = Schema.Struct({
  id: Schema.optionalKey(Id),
  legalEntityId: Schema.optionalKey(Id),
  direction: Schema.optionalKey(Schema.Literals(["incoming", "outgoing"])),
  asOf: Schema.optionalKey(CalendarDate),
  statementPartyId: Schema.optionalKey(Id),
  from: Schema.optionalKey(CalendarDate),
  to: Schema.optionalKey(CalendarDate),
})

export default function SettlementRoute() {
  const location = useLocation()
  const params = useParams<{ id?: string }>()
  const route = createMemo(() => decodeRouteInput(RouteInput, location.search, params.id))

  return (
    <DecodedConnectedSessionRoute
      route={route}
      invalidTitle="Invalid route"
      invalidDescription="Use valid IDs, dates, and a supported direction."
      invalidHref="/settlement"
      invalidLink="Open Payments"
      title="Payments"
      description="Connect a valid session to view payments."
    >
      {(route) => (
        <Settlement
          selectedPaymentId={route.id}
          legalEntityId={route.legalEntityId}
          direction={route.direction}
          asOf={route.asOf}
          statementPartyId={route.statementPartyId}
          from={route.from}
          to={route.to}
        />
      )}
    </DecodedConnectedSessionRoute>
  )
}
