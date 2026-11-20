import { useParams } from "@solidjs/router"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { createMemo, Show } from "solid-js"
import { ProductDetail } from "../../features/product/product-detail.tsx"
import { Products } from "../../features/product/product.tsx"
import { Uuid } from "../../shared/schemas.ts"
import { ConnectedSessionRoute, DecodedConnectedSessionRoute } from "../connected-route.tsx"

function ProductListRoute() {
  return (
    <ConnectedSessionRoute title="Products" description="Connect a valid session to view products.">
      {() => <Products />}
    </ConnectedSessionRoute>
  )
}

function ProductDetailRoute(props: { id: string | undefined }) {
  const route = createMemo(() => {
    const decoded = Schema.decodeUnknownResult(Uuid)(props.id)

    return Result.isSuccess(decoded) ? decoded.success : null
  })

  return (
    <DecodedConnectedSessionRoute
      route={route}
      invalidTitle="Invalid product link"
      invalidDescription="Open a product from the Products list."
      invalidHref="/product"
      invalidLink="Open Products"
      title="Product details"
      description="Connect a valid session to view this product."
    >
      {(id) => <ProductDetail id={id} />}
    </DecodedConnectedSessionRoute>
  )
}

export default function ProductRoute() {
  const params = useParams<{ id?: string }>()

  return (
    <Show when={params.id !== undefined} fallback={<ProductListRoute />}>
      <ProductDetailRoute id={params.id} />
    </Show>
  )
}
