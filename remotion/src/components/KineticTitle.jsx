import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

export const KineticTitle = ({
  title = "THE GREAT SIEGE",
  subtitle = "YEAR 1066",
  bgColor = "#1B2A4A",
  textColor = "#F5C518",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleSpring = spring({
    frame,
    fps,
    config: {
      damping: 12,
      stiffness: 180,
    },
  });

  const subtitleSpring = spring({
    frame: frame - 12,
    fps,
    config: {
      damping: 14,
      stiffness: 150,
    },
  });

  const scale = interpolate(titleSpring, [0, 1], [0.4, 1]);
  const opacity = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: "clamp" });
  const subScale = interpolate(subtitleSpring, [0, 1], [0.6, 1]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: bgColor,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "'Permanent Marker', Impact, sans-serif",
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          opacity,
          fontSize: "130px",
          color: textColor,
          WebkitTextStroke: "16px #000000",
          paintOrder: "stroke fill",
          letterSpacing: "4px",
          textAlign: "center",
        }}
      >
        {title}
      </div>
      {frame >= 12 && (
        <div
          style={{
            transform: `scale(${subScale})`,
            marginTop: "24px",
            fontSize: "64px",
            color: "#FFFFFF",
            WebkitTextStroke: "10px #000000",
            paintOrder: "stroke fill",
            letterSpacing: "2px",
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
};
