import { Tax } from "../../features/tax/tax.tsx"
import { ConnectedSessionRoute } from "../connected-route.tsx"

export default function TaxRoute() {
  return (
    <ConnectedSessionRoute title="Tax" description="Connect a valid session to view tax codes.">
      {() => <Tax />}
    </ConnectedSessionRoute>
  )
}
