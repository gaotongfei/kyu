import classes from '../../components/JobCatalog/JobCatalog.module.css';

export default function Loading() {
  return (
    <div className={classes.catalog}>
      <div className={classes.frame}>
        <main className={classes.main}>
          <p role="status">Loading catalog… Reading previously collected jobs only.</p>
        </main>
      </div>
    </div>
  );
}
