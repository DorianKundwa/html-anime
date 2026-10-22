import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

export const StatCard = ({
  label = "SURVIVAL RATE",
  percentage = 84,
  accentColor = "#D94040",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardSpring = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 160 },
  });

  const progress = interpolate(frame, [10, 60], [0, percentage], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const scale = interpolate(cardSpring, [0, 1], [0.8, 1]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "transparent",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "'Permanent Marker', sans-serif",
      }}
    >
      <div
        style={{
          width: "900px",
          backgroundColor: "#C4965A",
          border: "12px solid #000000",
          borderRadius: "24px",
          padding: "48px",
          transform: `scale(${scale})`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            fontSize: "56px",
            color: "#000000",
            marginBottom: "32px",
            letterSpacing: "2px",
          }}
        >
          {label}
        </div>
        <div
          style={{
            width: "100%",
            height: "64px",
            backgroundColor: "#FFFFFF",
            border: "8px solid #000000",
            borderRadius: "16px",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              backgroundColor: accentColor,
              borderRight: progress > 0 ? "8px solid #000000" : "none",
            }}
          />
        </div>
        <div
          style={{
            fontSize: "80px",
            color: "#F5C518",
            WebkitTextStroke: "12px #000000",
            paintOrder: "stroke fill",
            marginTop: "24px",
          }}
        >
          {Math.round(progress)}%
        </div>
      </div>
    </div>
  );
};
