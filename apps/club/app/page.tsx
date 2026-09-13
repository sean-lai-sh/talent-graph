import { redirect } from "next/navigation";

/** `/` is a door only: old links land on the public seed at `/example`. */
export default function HomeRedirect() {
  redirect("/example");
}
