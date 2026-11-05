import { withCrumb } from "../crumbs";
import WelcomeBase from "./Welcome.svelte";

export const Welcome = withCrumb(WelcomeBase, { src: "src/components/Welcome.svelte" });
