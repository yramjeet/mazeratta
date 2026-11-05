import { withCrumb } from "../crumbs";
import WelcomeBase from "./Welcome";

export const Welcome = withCrumb(WelcomeBase, { src: "src/components/Welcome.tsx" });
