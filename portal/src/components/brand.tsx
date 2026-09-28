import Link from "next/link";

export function Brand({ right }: { right?: React.ReactNode }) {
  return (
    <header className="top">
      <Link href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
        <b>Mlinjana Financial Group</b>
        <span>Restructure. Rebuild. Rise.</span>
      </Link>
      {right}
    </header>
  );
}

export function LogoutButton() {
  return (
    <form action="/logout" method="post">
      <button className="btn ghost small" type="submit">
        Log out
      </button>
    </form>
  );
}
