import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

export const DialogueBox = ({
  speaker = "KING EDWARD",
  text = "Retreat is not an option!",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pop = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 170 },
  });

  const scale = interpolate(pop, [0, 1], [0.5, 1]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "transparent",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        paddingBottom: "120px",
        boxSizing: "border-box",
        fontFamily: "'Permanent Marker', sans-serif",
      }}
    >
      <div
        style={{
          width: "1200px",
          backgroundColor: "#FFFFFF",
          border: "10px solid #000000",
          borderRadius: "20px",
          padding: "32px 48px",
          transform: `scale(${scale})`,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-36px",
            left: "40px",
            backgroundColor: "#F5820D",
            color: "#FFFFFF",
            border: "8px solid #000000",
            borderRadius: "12px",
            padding: "4px 20px",
            fontSize: "36px",
          }}
        >
          {speaker}
        </div>
        <div
          style={{
            fontSize: "44px",
            color: "#000000",
            marginTop: "8px",
            letterSpacing: "1px",
          }}
        >
          "{text}"
        </div>
      </div>
    </div>
  );
};
