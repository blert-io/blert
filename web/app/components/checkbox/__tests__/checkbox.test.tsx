/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';

import Checkbox from '../checkbox';

describe('Checkbox', () => {
  describe('Rendering', () => {
    it('renders a checkbox input', () => {
      render(<Checkbox label="Test checkbox" />);
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('renders with label text', () => {
      render(<Checkbox label="Accept terms" />);
      expect(screen.getByText('Accept terms')).toBeInTheDocument();
    });

    it('renders checked when checked prop is true', () => {
      render(<Checkbox label="Test" checked={true} />);
      expect(screen.getByRole('checkbox')).toBeChecked();
    });

    it('renders unchecked when checked prop is false', () => {
      render(<Checkbox label="Test" checked={false} />);
      expect(screen.getByRole('checkbox')).not.toBeChecked();
    });

    it('renders unchecked when checked prop is undefined', () => {
      render(<Checkbox label="Test" />);
      expect(screen.getByRole('checkbox')).not.toBeChecked();
    });

    it('applies button styling by default', () => {
      const { container } = render(<Checkbox label="Test" />);
      const label = container.querySelector('label');
      expect(label?.className).toContain('button');
    });

    it('does not apply button styling when simple is true', () => {
      const { container } = render(<Checkbox label="Test" simple={true} />);
      const label = container.querySelector('label');
      expect(label?.className).not.toContain('button');
    });

    it('accepts a custom className', () => {
      const { container } = render(
        <Checkbox label="Test" className="custom-class" />,
      );
      const label = container.querySelector('label');
      expect(label?.className).toContain('custom-class');
    });

    it('disabled prop disables the input', () => {
      render(<Checkbox label="Test" disabled={true} />);
      expect(screen.getByRole('checkbox')).toBeDisabled();
    });

    it('is enabled when disabled is false', () => {
      render(<Checkbox label="Test" disabled={false} />);
      expect(screen.getByRole('checkbox')).not.toBeDisabled();
    });

    it('is enabled when disabled is undefined', () => {
      render(<Checkbox label="Test" />);
      expect(screen.getByRole('checkbox')).not.toBeDisabled();
    });
  });

  describe('Interaction', () => {
    it('calls onChange with true when unchecked checkbox is clicked', () => {
      const handleChange = jest.fn();
      render(<Checkbox label="Test" checked={false} onChange={handleChange} />);

      fireEvent.click(screen.getByRole('checkbox'));

      expect(handleChange).toHaveBeenCalledTimes(1);
      expect(handleChange).toHaveBeenCalledWith(true);
    });

    it('calls onChange with false when checked checkbox is clicked', () => {
      const handleChange = jest.fn();
      render(<Checkbox label="Test" checked={true} onChange={handleChange} />);

      fireEvent.click(screen.getByRole('checkbox'));

      expect(handleChange).toHaveBeenCalledTimes(1);
      expect(handleChange).toHaveBeenCalledWith(false);
    });

    it('triggers on label click', () => {
      const handleChange = jest.fn();
      render(<Checkbox label="Click me" onChange={handleChange} />);

      fireEvent.click(screen.getByText('Click me'));

      expect(handleChange).toHaveBeenCalledTimes(1);
    });
  });
});
