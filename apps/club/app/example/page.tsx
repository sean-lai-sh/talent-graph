import { redirect } from "next/navigation";

/** Old public-seed URL. The hidden board now lives at `/demo`. */
export default function ExampleRedirect() {
  redirect("/demo");
}
