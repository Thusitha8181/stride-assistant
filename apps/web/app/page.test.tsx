import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("renders the assistant shell with categories from the shared contract", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "Customer Assistant" })).toBeInTheDocument();
    const categories = screen.getByRole("list");
    expect(categories.children).toHaveLength(6);
    expect(screen.getByText("trail")).toBeInTheDocument();
  });
});
