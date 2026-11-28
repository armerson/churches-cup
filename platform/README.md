This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Production authentication

For the Churches Cup deployment, set `NEXT_PUBLIC_SITE_URL` in Vercel to
`https://events.ambassadorsfc.org`.

In the same Supabase project's Authentication → URL Configuration, set:

- Site URL: `https://events.ambassadorsfc.org`
- Redirect URLs: `https://events.ambassadorsfc.org/reset-password` and
  `https://events.ambassadorsfc.org/auth/confirm`

Keep any development redirect URLs needed for local work. New reset requests
can be made at `/forgot-password`. Open app-requested reset emails in the
browser that requested them (PKCE). Dashboard-generated recovery emails return
to the Site URL and are forwarded to the reset page with their session tokens
kept in the URL fragment until they are exchanged into cookies. The app removes
the fragment before rendering the password form.

After changing Supabase's Site URL, request a fresh reset email: links already
sent still contain their original redirect address.

## Team creation permissions

If the existing hosted schema reports `permission denied for table teams`,
apply `supabase/migrations/20261128091741_team_creation_api_grants.sql` in that
project's SQL Editor. It grants the operations used by team creation/listing
while retaining RLS and rejecting a forged team owner. Do not rerun the full
combined installer on an existing database.
