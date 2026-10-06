import { RunList } from "@/components/RunList";
import { SubmitForm } from "@/components/SubmitForm";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <h1>Review a pull request</h1>
      <SubmitForm demoPr="demo/acme-shop#42" demoMode={!process.env.GITHUB_TOKEN} />
      <h2>Recent runs</h2>
      <RunList />
    </>
  );
}
