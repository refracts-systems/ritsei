import "./ui/styles.ts"
import { render } from "@solidjs/web"
import { App } from "./app/app.tsx"

const root = document.getElementById("app")

if (!root) throw new Error("Missing application mount point")

render(() => <App />, root)
