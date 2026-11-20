import { useLocation, useNavigate, useParams } from "@solidjs/router"
import * as Schema from "effect/Schema"
import { createMemo } from "solid-js"
import { Onboarding } from "../../features/onboarding/onboarding.tsx"
import { Uuid } from "../../shared/schemas.ts"
import { DecodedConnectedSessionRoute } from "../connected-route.tsx"
import { decodeRouteInput } from "../route-input.ts"

const RouteInput = Schema.Struct({ id: Schema.optionalKey(Uuid) })

export default function OnboardingRoute() {
  const location = useLocation()
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const route = createMemo(() => decodeRouteInput(RouteInput, location.search, params.id))

  return (
    <DecodedConnectedSessionRoute
      route={route}
      invalidTitle="Invalid import link"
      invalidDescription="Open a batch using its import link or start a new import."
      invalidHref="/onboarding"
      invalidLink="Open Data imports"
      title="Data imports"
      description="Connect a valid session to import Party records."
    >
      {(batch) => (
        <Onboarding batchId={batch.id} openBatch={(id) => navigate(`/onboarding/${id}`)} />
      )}
    </DecodedConnectedSessionRoute>
  )
}
