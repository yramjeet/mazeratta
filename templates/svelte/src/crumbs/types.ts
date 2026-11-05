import type { CrumbNote } from "./util";

export interface CrumbMeta {
  src: string;
  placement?: "top" | "bottom";
  onSubmit?: (note: CrumbNote) => Promise<void>;
}
