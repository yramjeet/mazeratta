import { withCrumb } from "./crumbs";
import AppBase from "./App";

export const App = withCrumb(AppBase, { src: "src/App.tsx" });
