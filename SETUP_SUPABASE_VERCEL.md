# SI-CMMS — Setup: GitHub (second account) → Supabase → Vercel

Follow these in order. Each step says what it does and how to confirm it worked.

**The one trap that catches everyone:** your browser is probably already signed
into your *main* GitHub account. Supabase and Vercel both use "Sign in with
GitHub", and they will silently link whichever account the browser is already
holding. Do Parts D and E in a **private/incognito window**, or sign out of
GitHub in your normal window first.

---

## Part A — Install the GitHub CLI

Your machine has git 2.55 but not `gh`. `gh` handles authentication and repo
creation, and it fixes the credential problem in Part B.

**A1.** Install it:

```
winget install --id GitHub.cli -e
```

**A2.** Close and reopen your terminal (the PATH change needs a fresh shell),
then confirm:

```
gh --version
```

---

## Part B — Authenticate as the *other* GitHub account

Your system credential helper is Git Credential Manager (`manager`). Left alone,
it will authenticate every push as whatever GitHub account Windows has cached —
this is why "I pushed with the wrong account" happens. Step B2 fixes it.

**B1.** Log in. Choose `GitHub.com` → `HTTPS` → `Login with a web browser`:

```
gh auth login
```

When the browser opens, **make sure you are signing in as the second account**.
If your main account is already signed in, open the shown URL in a private
window instead.

**B2.** Make `gh` the credential helper for github.com specifically. This resets
the helper list for that host and puts `gh` in front of Credential Manager:

```
gh auth setup-git
```

**B3.** Confirm the active account is the one you want:

```
gh auth status
```

You should see the second account's username with `- Active account: true`.

> If you later need to hop between accounts: `gh auth login` a second time with
> the other one, then `gh auth switch` to toggle. `gh auth status` always shows
> which is active.

---

## Part C — Create the repository and push

**C1.** Initialise the repo (from `C:\Users\Ahmad Amirul\SI-CMMS\SI-CMMS`):

```
git init -b main
```

**C2.** Set the commit identity **for this repo only**. You have no global git
identity set, and you should keep it that way — a repo-local identity is what
stops this project's commits being attributed to your main account.

Get the second account's noreply email from GitHub → Settings → Emails → it
looks like `12345678+username@users.noreply.github.com`. Using it keeps your
real address out of the public commit log.

```
git config user.name "Your Second Account Name"
```

```
git config user.email "12345678+username@users.noreply.github.com"
```

**C3.** Before committing anything, confirm the secrets are actually ignored.
Both commands must print a matching `.gitignore` rule:

```
git check-ignore -v app/.env.local .mcp.json
```

Then eyeball what would be committed — `node_modules`, `.next`, and `out`
should be absent:

```
git add -A && git status --short
```

**C4.** Commit:

```
git commit -m "SI-CMMS: work order module before Supabase migration"
```

**C5.** Create the repo under the second account and push in one step:

```
gh repo create SI-CMMS --private --source=. --remote=origin --push
```

Confirm it landed under the right account:

```
gh repo view --web
```

---

## Part D — Supabase (sign in with GitHub)

**D1.** In a **private/incognito window**, go to
<https://supabase.com/dashboard> and choose **Continue with GitHub**. Sign in as
the second account and authorise Supabase.

**D2.** **New project**:
- Name: `si-cmms`
- Database password: generate one and **save it in your password manager now** —
  Supabase shows it once and you cannot recover it later.
- Region: pick the one nearest your users (Singapore or Mumbai for Malaysia/India).
- Plan: Free.

Provisioning takes ~2 minutes.

**D3.** Collect three values:
- **Project ref** — the ID in the dashboard URL:
  `https://supabase.com/dashboard/project/<THIS_PART>`
- **Project URL** and **anon public key** — Project Settings → API

**D4.** Create a personal access token at
<https://supabase.com/dashboard/account/tokens> → **Generate new token**, name it
`claude-code`. Copy it (starts with `sbp_`) — shown only once.

**D5.** Store the token as an environment variable so it never touches the repo:

```
setx SUPABASE_ACCESS_TOKEN "sbp_paste_your_token_here"
```

Then copy the MCP template and fill in your project ref:

```
cp .mcp.json.example .mcp.json
```

Open `.mcp.json` and replace `YOUR_PROJECT_REF` with the value from D3.
(`.mcp.json` is gitignored, so the file stays local.)

**D6.** **Fully quit and reopen Claude Code.** `setx` only affects processes
started after it runs, and the MCP server list is read at startup.

---

## Part E — Vercel (sign in with GitHub)

**E1.** Still in the **private window**, go to <https://vercel.com/signup> and
choose **Continue with GitHub** as the second account.

**E2.** When Vercel asks to install its GitHub App, grant it access to the
`SI-CMMS` repository (you can pick "Only select repositories").

**E3.** **Add New → Project** → import `SI-CMMS`.

**E4.** Configure — this part matters, because your Next.js app is in a
subdirectory:
- **Root Directory:** `app`  ← click Edit and set this, it is not the default
- **Framework Preset:** Next.js (auto-detected)
- Leave build and output settings alone.

**E5.** Add environment variables (from step D3), for all three environments:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon public key |

The anon key is safe to expose — it is enforced by Row Level Security, exactly
like the old Firebase web API key was enforced by security rules.

**E6.** **Deploy.** The first deploy will fail or render blank until the code
migration is finished — that is expected, and it is fine. What matters is that
the project exists and is wired to the repo, so every later push auto-deploys.

---

## Part F — Hand back to Claude

Once D6 is done and Claude Code has restarted, tell Claude:

> Supabase MCP is connected, project ref is `<ref>`. Continue the migration.

Claude will then apply the SQL migrations in `app/supabase/migrations/`, rewrite
the client data layer, seed the database, and create the user accounts.

---

## Quick reference

| What | Where |
|---|---|
| Which GitHub account is active | `gh auth status` |
| Switch GitHub account | `gh auth switch` |
| Supabase project ref | dashboard URL |
| Supabase API keys | Project Settings → API |
| Supabase access token | <https://supabase.com/dashboard/account/tokens> |
| Vercel root directory | Project Settings → General → Root Directory = `app` |
