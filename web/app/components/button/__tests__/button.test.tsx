/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';

import { Button } from '../button';

describe('Button', () => {
  describe('Rendering', () => {
    it('renders children content', () => {
      render(<Button>Click me</Button>);
      expect(screen.getByRole('button')).toHaveTextContent('Click me');
    });

    it('renders complex children', () => {
      render(
        <Button>
          <span>Icon</span> Text
        </Button>,
      );

      expect(screen.getByRole('button')).toHaveTextContent('Icon');
      expect(screen.getByRole('button')).toHaveTextContent('Text');
    });

    it('renders Spinner when loading is true', () => {
      const { container } = render(<Button loading={true}>Submit</Button>);
      const spinner = container.querySelector('[class*="spinner"]');
      expect(spinner).toBeInTheDocument();
    });

    it('hides children when loading is true', () => {
      render(<Button loading={true}>Submit</Button>);
      expect(screen.getByRole('button')).not.toHaveTextContent('Submit');
    });

    it('shows children when loading is false', () => {
      render(<Button loading={false}>Submit</Button>);
      expect(screen.getByRole('button')).toHaveTextContent('Submit');
    });

    it('applies simple styling when simple prop is true', () => {
      const { container } = render(<Button simple={true}>Simple</Button>);
      const button = container.querySelector('button');
      expect(button?.className).toContain('simple');
    });

    it('does not apply simple styling by default', () => {
      const { container } = render(<Button>Default</Button>);
      const button = container.querySelector('button');
      expect(button?.className).not.toContain('simple');
    });

    it('applies fluid width when fluid prop is true', () => {
      render(<Button fluid={true}>Fluid</Button>);
      expect(screen.getByRole('button')).toHaveStyle({ width: '100%' });
    });

    it('does not apply fluid width by default', () => {
      render(<Button>Default</Button>);
      expect(screen.getByRole('button')).not.toHaveStyle({ width: '100%' });
    });

    it('defaults type to button', () => {
      render(<Button>Default type</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
    });

    it('accepts a submit type', () => {
      render(<Button type="submit">Submit</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
    });

    it('accepts custom className', () => {
      const { container } = render(
        <Button className="custom-class">Custom</Button>,
      );
      const button = container.querySelector('button');

      expect(button?.className).toContain('custom-class');
    });

    it('accepts id prop', () => {
      render(<Button id="my-button">With ID</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('id', 'my-button');
    });

    it('passes through tooltip data attributes', () => {
      render(
        <Button data-tooltip-id="tooltip-1" data-tooltip-content="Tooltip text">
          With tooltip
        </Button>,
      );

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('data-tooltip-id', 'tooltip-1');
      expect(button).toHaveAttribute('data-tooltip-content', 'Tooltip text');
    });

    it('is disabled when disabled prop is true', () => {
      render(<Button disabled={true}>Disabled</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('is disabled when loading prop is true', () => {
      render(<Button loading={true}>Loading</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('override disabled state when loading', () => {
      render(
        <Button loading={true} disabled={false}>
          Loading
        </Button>,
      );
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('is enabled when both disabled and loading are false', () => {
      render(
        <Button disabled={false} loading={false}>
          Enabled
        </Button>,
      );
      expect(screen.getByRole('button')).not.toBeDisabled();
    });

    it('is enabled by default', () => {
      render(<Button>Default</Button>);
      expect(screen.getByRole('button')).not.toBeDisabled();
    });
  });

  describe('Interaction', () => {
    it('calls onClick when clicked', () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Click</Button>);

      fireEvent.click(screen.getByRole('button'));

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('does not throw when onClick is not provided', () => {
      render(<Button>No handler</Button>);

      expect(() => {
        fireEvent.click(screen.getByRole('button'));
      }).not.toThrow();
    });
  });
});
