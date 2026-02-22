import * as React from "react";

interface VidereLogoProps extends React.SVGProps<SVGSVGElement> {
  color?: string;
  opacity?: number;
}

export const VidereLogo: React.FC<VidereLogoProps> = ({
  color = "currentColor",
  opacity = 1,
  className = "",
  style,
  ...rest
}) => {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ color, opacity, ...(style as React.CSSProperties) }}
      aria-label="Videre Logo"
      {...rest}
    >
      <circle cx="16" cy="16" r="15" stroke="currentColor" strokeWidth="2" />
      <path
        d="M9 9L16 23L23 9H20.2L16 18L11.8 9H9Z"
        fill="currentColor"
      />
    </svg>
  );
};

export default VidereLogo;
