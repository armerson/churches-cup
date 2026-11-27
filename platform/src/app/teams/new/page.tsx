import { TeamForm } from "./team-form";

export default function NewTeamPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-xl font-semibold">Create a team</h1>
      <TeamForm />
    </main>
  );
}
