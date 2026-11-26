import classes from './SiteHeader.module.css';

export function SiteHeader({ activePage }: { activePage: 'jobs' | 'resumes' }) {
  return (
    <header className={classes.header}>
      <div className={classes.wordmark}>
        kyu<span>.</span>
      </div>
      <nav className={classes.navigation} aria-label="Main navigation">
        <a href="/jobs" aria-current={activePage === 'jobs' ? 'page' : undefined}>
          Discover
        </a>
        <a href="/resumes" aria-current={activePage === 'resumes' ? 'page' : undefined}>
          Resumes
        </a>
      </nav>
    </header>
  );
}
