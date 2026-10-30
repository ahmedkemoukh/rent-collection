import Link from 'next/link'
import { SignOutButton } from '@/components/sign-out-button'

export function AppHeader({ links, who }: { links: { href: string; label: string }[]; who: string }) {
  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-6 py-3">
        <span className="font-semibold">Rent Collection</span>
        <nav className="flex gap-3 text-sm">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="text-muted-foreground hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto text-sm text-muted-foreground">{who}</span>
        <SignOutButton />
      </div>
    </header>
  )
}
