package com.hpe.recipe.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public class HelmRelease {

    private String version;
    private String releaseName;
    private String status;
    private String cluster;   
    @JsonProperty("catalog_name")
    private String catalogName;
    @JsonProperty("catalog_description")
    private String catalogDescription;
    @JsonProperty("release_date")
    private String catalogReleaseDate;
    @JsonProperty("catalog_status")
    private String catalogStatus;
    private String maintainer;
    private String valuesFileName;
    private List<Recipe> recipes;

    public HelmRelease() {}

    public HelmRelease(String version, String releaseName, String status,
                       String cluster, List<Recipe> recipes) {
        this.version = version;
        this.releaseName = releaseName;
        this.status = status;
        this.cluster = cluster;
        this.recipes = recipes;
    }

    public HelmRelease(String version, String releaseName, String status,
                       String cluster, String catalogName, String catalogDescription,
                       String catalogReleaseDate, String catalogStatus, String maintainer,
                       List<Recipe> recipes) {
        this.version = version;
        this.releaseName = releaseName;
        this.status = status;
        this.cluster = cluster;
        this.catalogName = catalogName;
        this.catalogDescription = catalogDescription;
        this.catalogReleaseDate = catalogReleaseDate;
        this.catalogStatus = catalogStatus;
        this.maintainer = maintainer;
        this.recipes = recipes;
    }

    public String getVersion() { return version; }
    public void setVersion(String version) { this.version = version; }

    public String getReleaseName() { return releaseName; }
    public void setReleaseName(String releaseName) { this.releaseName = releaseName; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getCluster() { return cluster; }
    public void setCluster(String cluster) { this.cluster = cluster; }

    public String getCatalogName() { return catalogName; }
    public void setCatalogName(String catalogName) { this.catalogName = catalogName; }

    public String getCatalogDescription() { return catalogDescription; }
    public void setCatalogDescription(String catalogDescription) { this.catalogDescription = catalogDescription; }

    public String getCatalogReleaseDate() { return catalogReleaseDate; }
    public void setCatalogReleaseDate(String catalogReleaseDate) { this.catalogReleaseDate = catalogReleaseDate; }

    public String getCatalogStatus() { return catalogStatus; }
    public void setCatalogStatus(String catalogStatus) { this.catalogStatus = catalogStatus; }

    public String getMaintainer() { return maintainer; }
    public void setMaintainer(String maintainer) { this.maintainer = maintainer; }

    public String getValuesFileName() { return valuesFileName; }
    public void setValuesFileName(String valuesFileName) { this.valuesFileName = valuesFileName; }

    public List<Recipe> getRecipes() { return recipes; }
    public void setRecipes(List<Recipe> recipes) { this.recipes = recipes; }
}