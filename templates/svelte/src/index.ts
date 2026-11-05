import { withCrumb } from "./crumbs";
import AppBase from "./App.svelte";

export const App = withCrumb(AppBase, { src: "src/App.svelte" });
