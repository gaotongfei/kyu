import { SiteHeader } from '../../components/SiteHeader/SiteHeader';
import classes from '../../components/JobCatalog/JobCatalog.module.css';

export default function Loading() {
  return (
    <div className={classes.catalog}>
      <div className={classes.frame}>
        <SiteHeader activePage="jobs" />
        <main className={classes.main} aria-label="Job catalog">
          <p role="status">Loading catalog… Reading previously collected jobs only.</p>
        </main>
      </div>
    </div>
  );
}
