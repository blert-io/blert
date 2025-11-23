/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';

import Tabs from '../tabs';

function createTestTabs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    icon: `fa-icon-${i}`,
    title: `Tab ${i + 1}`,
    content: <div data-testid={`content-${i}`}>Content for tab {i + 1}</div>,
  }));
}

describe('Tabs', () => {
  describe('initial state', () => {
    it('renders the first tab as active by default', () => {
      const tabs = createTestTabs(3);
      render(<Tabs tabs={tabs} />);

      const tabButtons = screen.getAllByRole('button');
      expect(tabButtons[0].className).toContain('active');
      expect(tabButtons[1].className).not.toContain('active');
      expect(tabButtons[2].className).not.toContain('active');
    });

    it('displays content of the first tab initially', () => {
      const tabs = createTestTabs(3);
      render(<Tabs tabs={tabs} />);

      expect(screen.getByTestId('content-0')).toBeInTheDocument();
      expect(screen.queryByTestId('content-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('content-2')).not.toBeInTheDocument();
    });

    it('renders all tab buttons', () => {
      const tabs = createTestTabs(4);
      render(<Tabs tabs={tabs} />);

      const tabButtons = screen.getAllByRole('button');
      expect(tabButtons).toHaveLength(4);
    });

    it('renders tab titles', () => {
      const tabs = createTestTabs(2);
      render(<Tabs tabs={tabs} />);

      expect(screen.getByText('Tab 1')).toBeInTheDocument();
      expect(screen.getByText('Tab 2')).toBeInTheDocument();
    });

    it('renders tab icons', () => {
      const tabs = [
        { icon: 'fa-solid fa-home', title: 'Home', content: <div>Home</div> },
        {
          icon: 'fa-solid fa-gear',
          title: 'Settings',
          content: <div>Settings</div>,
        },
      ];
      const { container } = render(<Tabs tabs={tabs} />);

      const icons = container.querySelectorAll('i');
      expect(icons[0].className).toContain('fa-solid fa-home');
      expect(icons[1].className).toContain('fa-solid fa-gear');
    });

    it('renders an indicator element', () => {
      const tabs = createTestTabs(2);
      const { container } = render(<Tabs tabs={tabs} />);

      const indicator = container.querySelector('[class*="indicator"]');
      expect(indicator).toBeInTheDocument();
    });
  });

  describe('tab switching', () => {
    it('switches to second tab when clicked', () => {
      const tabs = createTestTabs(3);
      render(<Tabs tabs={tabs} />);

      fireEvent.click(screen.getByText('Tab 2'));

      const tabButtons = screen.getAllByRole('button');
      expect(tabButtons[0].className).not.toContain('active');
      expect(tabButtons[1].className).toContain('active');
      expect(tabButtons[2].className).not.toContain('active');
    });

    it('displays content of clicked tab', () => {
      const tabs = createTestTabs(3);
      render(<Tabs tabs={tabs} />);

      expect(screen.getByTestId('content-0')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Tab 2'));

      expect(screen.queryByTestId('content-0')).not.toBeInTheDocument();
      expect(screen.getByTestId('content-1')).toBeInTheDocument();
    });

    it('can switch between multiple tabs', () => {
      const tabs = createTestTabs(3);
      render(<Tabs tabs={tabs} />);

      expect(screen.getByTestId('content-0')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Tab 3'));
      expect(screen.getByTestId('content-2')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Tab 2'));
      expect(screen.getByTestId('content-1')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Tab 1'));
      expect(screen.getByTestId('content-0')).toBeInTheDocument();
    });

    it('clicking already active tab keeps it active', () => {
      const tabs = createTestTabs(2);
      render(<Tabs tabs={tabs} />);

      fireEvent.click(screen.getByText('Tab 1'));

      const tabButtons = screen.getAllByRole('button');
      expect(tabButtons[0].className).toContain('active');
      expect(screen.getByTestId('content-0')).toBeInTheDocument();
    });

    it('only has one active tab at a time', () => {
      const tabs = createTestTabs(4);
      render(<Tabs tabs={tabs} />);

      for (let i = 0; i < 4; i++) {
        fireEvent.click(screen.getByText(`Tab ${i + 1}`));

        const tabButtons = screen.getAllByRole('button');
        const activeCount = tabButtons.filter((btn) =>
          btn.className.includes('active'),
        ).length;

        expect(activeCount).toBe(1);
        expect(tabButtons[i].className).toContain('active');
      }
    });
  });

  describe('props', () => {
    it('applies fluid styling when fluid prop is true', () => {
      const tabs = createTestTabs(2);
      const { container } = render(<Tabs tabs={tabs} fluid={true} />);

      const tabsContainer = container.firstChild as HTMLElement;
      expect(tabsContainer.className).toContain('fluid');
    });

    it('does not apply fluid styling by default', () => {
      const tabs = createTestTabs(2);
      const { container } = render(<Tabs tabs={tabs} />);

      const tabsContainer = container.firstChild as HTMLElement;
      expect(tabsContainer.className).not.toContain('fluid');
    });

    it('applies small styling when small prop is true', () => {
      const tabs = createTestTabs(2);
      const { container } = render(<Tabs tabs={tabs} small={true} />);

      const tabsContainer = container.firstChild as HTMLElement;
      expect(tabsContainer.className).toContain('small');
    });

    it('does not apply small styling by default', () => {
      const tabs = createTestTabs(2);
      const { container } = render(<Tabs tabs={tabs} />);

      const tabsContainer = container.firstChild as HTMLElement;
      expect(tabsContainer.className).not.toContain('small');
    });

    it('applies maxHeight to content area', () => {
      const tabs = createTestTabs(2);
      const { container } = render(<Tabs tabs={tabs} maxHeight={300} />);

      const contentArea = container.querySelector('[class*="content"]');
      expect(contentArea).toHaveStyle({ maxHeight: '240px' });
    });

    it('does not apply maxHeight when not specified', () => {
      const tabs = createTestTabs(2);
      const { container } = render(<Tabs tabs={tabs} />);

      const contentArea = container.querySelector('[class*="content"]');
      expect(contentArea).not.toHaveStyle({ maxHeight: expect.any(String) });
    });
  });

  describe('edge cases', () => {
    it('handles tabs with no title', () => {
      const tabs = [{ icon: 'fa-icon', content: <div>Content</div> }];
      render(<Tabs tabs={tabs} />);

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('handles single tab', () => {
      const tabs = createTestTabs(1);
      render(<Tabs tabs={tabs} />);

      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(screen.getByTestId('content-0')).toBeInTheDocument();
    });

    it('handles empty tabs array gracefully', () => {
      const { container } = render(<Tabs tabs={[]} />);

      expect(container.firstChild).toBeInTheDocument();
      expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('renders complex content in tabs', () => {
      const tabs = [
        {
          icon: 'fa-icon',
          title: 'Complex',
          content: (
            <div>
              <h1>Heading</h1>
              <p>
                Paragraph with <strong>bold</strong> text
              </p>
              <ul>
                <li>Item 1</li>
                <li>Item 2</li>
              </ul>
            </div>
          ),
        },
      ];
      render(<Tabs tabs={tabs} />);

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Heading',
      );
      expect(screen.getByText('bold')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });
  });
});
