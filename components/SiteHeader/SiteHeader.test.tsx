import { render, screen, within } from '@testing-library/react';
import { SiteHeader } from './SiteHeader';

describe('SiteHeader', () => {
  it.each(['jobs', 'resumes'] as const)(
    'marks only %s as current in shared navigation',
    (activePage) => {
      render(<SiteHeader activePage={activePage} />);
      const header = screen.getByRole('banner');
      expect(header).toHaveTextContent('kyu.');
      const navigation = within(header).getByRole('navigation', { name: 'Main navigation' });
      const links = within(navigation).getAllByRole('link');
      expect(links).toHaveLength(2);
      expect(links[0]).toHaveTextContent('Discover');
      expect(links[0]).toHaveAttribute('href', '/jobs');
      expect(links[1]).toHaveTextContent('Resumes');
      expect(links[1]).toHaveAttribute('href', '/resumes');
      expect(links[activePage === 'jobs' ? 0 : 1]).toHaveAttribute('aria-current', 'page');
      expect(links[activePage === 'jobs' ? 1 : 0]).not.toHaveAttribute('aria-current');
    }
  );
});
