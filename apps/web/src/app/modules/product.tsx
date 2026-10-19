import { Products } from "../../features/product/product.tsx"
import { ConnectedSessionRoute } from "../connected-route.tsx"

export default function ProductRoute() {
  return (
    <ConnectedSessionRoute title="Products" description="Connect a valid session to view products.">
      {() => <Products />}
    </ConnectedSessionRoute>
  )
}
