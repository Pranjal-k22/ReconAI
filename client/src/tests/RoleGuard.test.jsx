import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoleGuard } from "../components/common/RoleGuard.jsx";
import * as AuthContextModule from "../context/AuthContext.jsx";

describe("RoleGuard Access Control Invariants", () => {
  it("allows access and renders children for ADMIN role", () => {
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      user: { role: "ADMIN", tenantId: null },
      isAuthenticated: true,
      loading: false
    });

    render(
      <RoleGuard>
        <div data-testid="protected-content">Operator Workspace</div>
      </RoleGuard>
    );

    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
    expect(screen.queryByText(/not available for your role/i)).not.toBeInTheDocument();
  });

  it("allows access and renders children for SHOP role", () => {
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      user: { role: "SHOP", tenantId: "tenant_demo_a" },
      isAuthenticated: true,
      loading: false
    });

    render(
      <RoleGuard>
        <div data-testid="protected-content">Operator Workspace</div>
      </RoleGuard>
    );

    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
  });

  it("allows access and renders children for AUDITOR role", () => {
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      user: { role: "AUDITOR", tenantId: "tenant_demo_a" },
      isAuthenticated: true,
      loading: false
    });

    render(
      <RoleGuard>
        <div data-testid="protected-content">Operator Workspace</div>
      </RoleGuard>
    );

    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
  });

  it("strictly blocks CUSTOMER role with 'not available for your role' without invoking children", () => {
    const apiCallSpy = vi.fn();
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      user: { role: "CUSTOMER", customerId: "cust_001", tenantId: "tenant_demo_a" },
      isAuthenticated: true,
      loading: false
    });

    const ChildComponent = () => {
      apiCallSpy();
      return <div>Customer Child</div>;
    };

    render(
      <RoleGuard>
        <ChildComponent />
      </RoleGuard>
    );

    expect(screen.getByText(/not available for your role/i)).toBeInTheDocument();
    expect(screen.queryByText("Customer Child")).not.toBeInTheDocument();
    expect(apiCallSpy).not.toHaveBeenCalled();
  });

  it("blocks service roles (CUSTOMER_AI, SHOP_AI, PAYMENT_CONTROLLER)", () => {
    for (const serviceRole of ["CUSTOMER_AI", "SHOP_AI", "PAYMENT_CONTROLLER", "EXTERNAL_SYSTEM"]) {
      vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
        user: { role: serviceRole },
        isAuthenticated: true,
        loading: false
      });

      const { unmount } = render(
        <RoleGuard>
          <div>Service Child</div>
        </RoleGuard>
      );

      expect(screen.getByText(/not available for your role/i)).toBeInTheDocument();
      expect(screen.queryByText("Service Child")).not.toBeInTheDocument();
      unmount();
    }
  });
});
