'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './TopNav.module.css'

const TABS = [
  { href: '/', label: 'Style Creation' },
  { href: '/kohl-sorting', label: 'Kohl Sorting' },
]

export default function TopNav() {
  const pathname = usePathname()

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        {TABS.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`${styles.tab} ${pathname === tab.href ? styles.tabActive : ''}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
