import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import useRealtimeReleases from "./hooks/useRealtimeReleases";
import T from "./theme";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from "reactflow";
import "reactflow/dist/style.css";
import buildGraph from "./graph/buildGraph";
import RecipeNode from "./components/visualizer/RecipeNode";
import ComponentNode from "./components/visualizer/ComponentNode";
import VersionTimeline from "./components/visualizer/VersionTimeline";
import DetailPanel from "./components/visualizer/DetailPanel";
import CompareView from "./components/visualizer/CompareView";
import StatsBar from "./components/visualizer/StatsBar";

const API_BASE = "/api";

const nodeTypes = { recipe: RecipeNode, component: ComponentNode };

// ============================================================================
// Main App
// ============================================================================
export default function App() {
  const [searchParams, setSearchParams] = useSearchParams();
  const versionParam = searchParams.get("version");
  const allowedClusters = ["dev", "prod", "qa", "integration"];
  const initialCluster = allowedClusters.includes(searchParams.get("cluster"))
    ? searchParams.get("cluster")
    : "dev";
  const [cluster, setCluster] = useState(initialCluster);
  const {
    helmReleases,
    loading: releasesLoading,
    error: releasesError,
  } = useRealtimeReleases(cluster);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [releaseDetail, setReleaseDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedRecipeVersion, setSelectedRecipeVersion] = useState(null);
  const [showCompare, setShowCompare] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const loading = releasesLoading || detailLoading;

  useEffect(() => {
    const urlCluster = allowedClusters.includes(searchParams.get("cluster"))
      ? searchParams.get("cluster")
      : "dev";
    setCluster((prev) => (prev === urlCluster ? prev : urlCluster));
  }, [searchParams]);

  useEffect(() => {
    const urlCluster = allowedClusters.includes(searchParams.get("cluster"))
      ? searchParams.get("cluster")
      : "dev";
    if (urlCluster !== cluster) {
      const next = new URLSearchParams(searchParams);
      next.set("cluster", cluster);
      setSearchParams(next, { replace: true });
    }
  }, [cluster, searchParams, setSearchParams, allowedClusters]);

  useEffect(() => {
    if (versionParam && helmReleases.some((r) => r.version === versionParam)) {
      setSelectedVersion(versionParam);
    }
  }, [versionParam, helmReleases]);

  // Sync error from realtime hook
  useEffect(() => {
    if (releasesError) setError(releasesError);
  }, [releasesError]);

  // Fetch detail when version selected
  useEffect(() => {
    if (!selectedVersion) {
      setReleaseDetail(null);
      setSelectedRecipeVersion(null);
      setNodes([]);
      setEdges([]);
      setError(null);
      return;
    }

    // Wait until releases for the current cluster are loaded, then validate selection.
    if (releasesLoading) return;

    const existsInCluster = helmReleases.some(
      (r) => r.version === selectedVersion,
    );
    if (!existsInCluster) {
      setSelectedVersion("");
      setReleaseDetail(null);
      setSelectedRecipeVersion(null);
      setNodes([]);
      setEdges([]);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setDetailLoading(true);
    setError(null);
    setSelectedRecipeVersion(null);
    fetch(`${API_BASE}/helm-releases/${selectedVersion}?cluster=${cluster}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setReleaseDetail(data);
        const { nodes: n, edges: e } = buildGraph(data.recipes || [], null);
        setNodes(n);
        setEdges(e);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setError(`Failed to load version ${selectedVersion}`);
        setReleaseDetail(null);
      })
      .finally(() => setDetailLoading(false));
    return () => controller.abort();
  }, [
    selectedVersion,
    cluster,
    releasesLoading,
    helmReleases,
    setNodes,
    setEdges,
  ]);

  // Rebuild graph on recipe selection
  useEffect(() => {
    if (!releaseDetail) return;
    const { nodes: n, edges: e } = buildGraph(
      releaseDetail.recipes || [],
      selectedRecipeVersion,
    );
    setNodes(n);
    setEdges(e);
  }, [selectedRecipeVersion, releaseDetail, setNodes, setEdges]);

  const onNodeClick = useCallback((_ev, node) => {
    if (node.type === "recipe") {
      setSelectedRecipeVersion((prev) =>
        prev === node.data.version ? null : node.data.version,
      );
    }
  }, []);

  const selectedRecipeObj = useMemo(() => {
    if (!releaseDetail || !selectedRecipeVersion) return null;
    return (releaseDetail.recipes || []).find(
      (r) => r.version === selectedRecipeVersion,
    );
  }, [releaseDetail, selectedRecipeVersion]);

  return (
    <div
      style={{
        fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: T.bg,
        color: T.text,
      }}
    >
      {/* Header */}
      <header
        style={{
          background: T.bgCard,
          borderBottom: `1px solid ${T.border}`,
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: `linear-gradient(135deg, ${T.teal}, ${T.tealDark})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              color: T.white,
              fontWeight: 800,
            }}
          >
            H
          </div>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 700,
                color: T.text,
                letterSpacing: -0.3,
              }}
            >
              HPE Recipe Detection
            </h1>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
              Helm Chart Version Visualizer
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <select
            value={cluster}
            onChange={(e) => setCluster(e.target.value)}
            style={{
              padding: "7px 10px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              background: T.bgSurface,
              color: T.text,
              border: `1px solid ${T.border}`,
              cursor: "pointer",
            }}
          >
            <option value="dev">DEV</option>
            <option value="prod">PROD</option>
            <option value="qa">QA</option>
            <option value="integration">INTEGRATION</option>
          </select>
          <span
            style={{
              fontSize: 11,
              color: T.textMuted,
              whiteSpace: "nowrap",
              fontWeight: 600,
              letterSpacing: 1,
            }}
          >
            RELEASES
          </span>
          <VersionTimeline
            releases={helmReleases}
            selected={selectedVersion}
            onSelect={setSelectedVersion}
            cluster={cluster}
          />

          <Link
            to={`/catalogs?cluster=${cluster}`}
            style={{
              padding: "7px 16px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              background: T.bgSurface,
              border: `1px solid ${T.border}`,
              color: T.textMuted,
              cursor: "pointer",
              transition: "all 0.2s",
              whiteSpace: "nowrap",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ← All Catalogs
          </Link>
          {selectedVersion && (
            <button
              onClick={() => setShowCompare(true)}
              style={{
                padding: "7px 16px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                background: T.bgSurface,
                border: `1px solid ${T.border}`,
                color: T.textMuted,
                cursor: "pointer",
                transition: "all 0.2s",
                whiteSpace: "nowrap",
              }}
            >
              Compare
            </button>
          )}
          <Link
            to={`/manage?cluster=${cluster}`}
            style={{
              padding: "7px 16px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              background: T.teal,
              color: T.white,
              textDecoration: "none",
              cursor: "pointer",
              transition: "all 0.2s",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            + Manage
          </Link>
        </div>
      </header>

      {/* Stats bar */}
      <StatsBar release={releaseDetail} />

      {/* Error / loading */}
      {error && (
        <div
          style={{
            background: `${T.red}15`,
            color: T.red,
            padding: "10px 24px",
            fontSize: 13,
            borderBottom: `1px solid ${T.red}33`,
          }}
        >
          {error}
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, position: "relative" }}>
          {!selectedVersion && !loading && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 20,
                  margin: "0 auto 20px",
                  background: T.bgCard,
                  border: `1px solid ${T.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 36,
                }}
              >
                📊
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  color: T.text,
                  marginBottom: 8,
                }}
              >
                Select a Catalog
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: T.textMuted,
                  maxWidth: 360,
                  lineHeight: 1.6,
                }}
              >
                View catalogs to select a release and visualize recipes,
                components, and upgrade paths.
              </div>
              {helmReleases.length > 0 && (
                <Link
                  to={`/catalogs?cluster=${cluster}`}
                  style={{
                    marginTop: 20,
                    padding: "10px 24px",
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    background: T.teal,
                    color: T.white,
                    border: "none",
                    cursor: "pointer",
                    boxShadow: `0 4px 14px ${T.teal}44`,
                    textDecoration: "none",
                    display: "inline-block",
                  }}
                >
                  View All Catalogs
                </Link>
              )}
            </div>
          )}

          {loading && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                textAlign: "center",
                color: T.textMuted,
                fontSize: 14,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  border: `3px solid ${T.border}`,
                  borderTopColor: T.teal,
                  animation: "spin 0.8s linear infinite",
                  margin: "0 auto 12px",
                }}
              />
              Loading...
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {selectedVersion && releaseDetail && !loading && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.35 }}
              minZoom={0.3}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
              style={{ background: T.bg }}
            >
              <Background color={T.textDim} gap={24} size={1} />
              <Controls
                style={{
                  bottom: 16,
                  left: 16,
                  borderRadius: 10,
                  overflow: "hidden",
                  border: `1px solid ${T.border}`,
                  background: T.bgCard,
                }}
                showInteractive={false}
              />
              <MiniMap
                nodeColor={(n) =>
                  n.type === "recipe"
                    ? T.teal
                    : n.data?.theme?.border || T.textDim
                }
                maskColor="rgba(13,17,23,0.8)"
                style={{
                  bottom: 16,
                  right: 16,
                  borderRadius: 10,
                  border: `1px solid ${T.border}`,
                  background: T.bgCard,
                }}
              />
            </ReactFlow>
          )}

          {/* Click hint */}
          {selectedVersion &&
            releaseDetail &&
            !selectedRecipeVersion &&
            !loading && (
              <div
                style={{
                  position: "absolute",
                  bottom: 20,
                  left: "50%",
                  transform: "translateX(-50%)",
                  padding: "8px 18px",
                  borderRadius: 20,
                  background: T.bgCard,
                  border: `1px solid ${T.border}`,
                  fontSize: 12,
                  color: T.textMuted,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                }}
              >
                Click a recipe node to expand its components
              </div>
            )}
        </div>

        {/* Detail panel */}
        {selectedRecipeObj && (
          <DetailPanel
            recipe={selectedRecipeObj}
            helmVersion={selectedVersion}
            allRecipes={releaseDetail.recipes || []}
            onClose={() => setSelectedRecipeVersion(null)}
          />
        )}
      </div>

      {/* Compare modal */}
      {showCompare && (
        <CompareView
          releases={helmReleases}
          currentVersion={selectedVersion}
          cluster={cluster}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  );
}
