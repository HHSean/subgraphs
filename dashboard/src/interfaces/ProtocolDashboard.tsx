import { CircularProgress } from "@mui/material";
import { ApolloClient, ApolloError, gql, HttpLink, InMemoryCache, useLazyQuery, useQuery } from "@apollo/client";

import { Chart as ChartJS, registerables, PointElement } from "chart.js";
import React, { useEffect, useMemo, useState } from "react";
import { poolOverview, schema } from "../queries/schema";
import { PoolNames, ProtocolType, SubgraphBaseUrl } from "../constants";
import ErrorDisplay from "./ErrorDisplay";
import { useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router";
import { isValidHttpUrl, NewClient } from "../utils";
import AllDataTabs from "./AllDataTabs";
import { DashboardHeader } from "../graphs/DashboardHeader";
import { getPendingSubgraphId, nameQuery } from "../queries/subgraphStatusQuery";
import { getSnapshotDailyVolume } from "../queries/snapshotDailyVolumeQuery";
import { styled } from "../styled";
import { poolOverviewTokensQuery } from "../queries/poolOverviewTokensQuery";

const BackBanner = styled("div")`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing(1)};
  padding-left: ${({ theme }) => theme.spacing(2)};
  padding-right: ${({ theme }) => theme.spacing(2)};
  padding-top: ${({ theme }) => theme.spacing(1)};
  padding-bottom: ${({ theme }) => theme.spacing(1)};
  background: #20252c;
  cursor: pointer;
`;

function ProtocolDashboard() {
  const [searchParams] = useSearchParams();
  const subgraphParam = searchParams.get("endpoint") || "";
  const tabString = searchParams.get("tab") || "";
  const poolIdString = searchParams.get("poolId") || "";
  const scrollToView = searchParams.get("view") || "";
  const skipAmtParam = Number(searchParams.get("skipAmt")) || 0;
  const version = searchParams.get("version") || "current";

  const navigate = useNavigate();
  let queryURL = `${SubgraphBaseUrl}${subgraphParam}`;
  let subgraphName = subgraphParam;
  if (subgraphParam) {
    const parseCheck = isValidHttpUrl(subgraphParam);
    if (parseCheck) {
      queryURL = subgraphParam;
      if (queryURL.includes("name/") && !searchParams.get("name")) {
        subgraphName = queryURL.split("name/")[1];
      } else if (searchParams.get("name")) {
        subgraphName = searchParams.get("name") || "";
      } else {
        subgraphName = "";
      }
    }
  }

  const [subgraphToQuery, setSubgraphToQuery] = useState({ url: queryURL, version: "" });
  const endpointObject: { [x: string]: string } = { current: "", pending: "" };
  endpointObject[version] = queryURL;
  if (subgraphName && !endpointObject.current) {
    endpointObject.current = "https://api.thegraph.com/subgraphs/name/" + subgraphName;
  }
  const [endpoints, setEndpoints] = useState(endpointObject);
  const [isCurrentVersion, setIsCurrentVersion] = useState(version == "current" ? true : false);
  const [poolId, setPoolId] = useState<string>(poolIdString);
  const [skipAmt, paginate] = useState<number>(skipAmtParam);

  const clientIndexing = useMemo(() => NewClient("https://api.thegraph.com/index-node/graphql"), [subgraphParam]);

  const [getPendingSubgraph, { data: pendingVersion, error: errorSubId, loading: subIdLoading }] = useLazyQuery(
    getPendingSubgraphId,
    {
      variables: { subgraphName },
      client: clientIndexing,
    },
  );

  const [positionSnapshots, setPositionSnapshots] = useState();
  const [positionsLoading, setPositionsLoading] = useState(false);
  ChartJS.register(...registerables);
  const client = useMemo(() => {
    return new ApolloClient({
      link: new HttpLink({
        uri: subgraphToQuery.url,
      }),
      cache: new InMemoryCache(),
    });
  }, [subgraphToQuery.url]);
  const query = gql`
    {
      protocols {
        type
        schemaVersion
        subgraphVersion
        methodologyVersion
        name
        id
        network
      }
      _meta {
        deployment
      }
    }
  `;

  // This query is to fetch data about the protocol. This helps select the proper schema to make the full query
  const {
    data: protocolSchemaData,
    loading: protocolSchemaQueryLoading,
    error: protocolSchemaQueryError,
  } = useQuery(query, { client });

  // By default, set the schema version to the user selected. If user has not selected, go to the version on the protocol entity
  let schemaVersion = subgraphToQuery.version;
  if (!schemaVersion && protocolSchemaData?.protocols[0]?.schemaVersion) {
    schemaVersion = protocolSchemaData.protocols[0].schemaVersion;
  }
  let protocolIdString = searchParams.get("protocolId");
  let protocolIdToUse: string = "";
  if (typeof protocolIdString === "string") {
    protocolIdToUse = protocolIdString;
  }
  let protocolType = "N/A";
  if (protocolSchemaData?.protocols?.length > 0) {
    protocolType = protocolSchemaData?.protocols[0]?.type;
    if (protocolSchemaData.protocols[0]?.id && !protocolIdToUse) {
      protocolIdToUse = protocolSchemaData.protocols[0]?.id;
    }
  }

  const [protocolId, setprotocolId] = useState<string>(protocolIdToUse);

  // The following section fetches the full data from the subgraph. It routes to query selection and then makes the request

  const {
    entitiesData,
    poolData,
    query: graphQuery,
    events,
    protocolFields,
    financialsQuery,
    dailyUsageQuery,
    hourlyUsageQuery,
    protocolTableQuery,
    poolsQuery,
    poolTimeseriesQuery,
    positionsQuery = "",
  } = schema(protocolType, schemaVersion);

  const queryMain = gql`
    ${graphQuery}
  `;
  const [getData, { data, loading, error }] = useLazyQuery(queryMain, { variables: { poolId, protocolId }, client });

  const [
    getFinancialsData,
    { data: financialsData, loading: financialsLoading, error: financialsError, refetch: financialsRefetch },
  ] = useLazyQuery(
    gql`
      ${financialsQuery}
    `,
    { client },
  );
  const [
    getDailyUsageData,
    { data: dailyUsageData, loading: dailyUsageLoading, error: dailyUsageError, refetch: dailyUsageRefetch },
  ] = useLazyQuery(
    gql`
      ${dailyUsageQuery}
    `,
    { client },
  );
  const [
    getHourlyUsageData,
    { data: hourlyUsageData, loading: hourlyUsageLoading, error: hourlyUsageError, refetch: hourlyUsageRefetch },
  ] = useLazyQuery(
    gql`
      ${hourlyUsageQuery}
    `,
    { client },
  );

  const [getProtocolTableData, { data: protocolTableData, loading: protocolTableLoading, error: protocolTableError }] =
    useLazyQuery(
      gql`
        ${protocolTableQuery}
      `,
      { client, variables: { protocolId: protocolIdToUse } },
    );

  const [
    getPoolsListData,
    { data: poolsListData, loading: poolListLoading, error: poolsListError, refetch: poolsListRefetch },
  ] = useLazyQuery(
    gql`
      ${poolsQuery}
    `,
    { client },
  );
  const [
    getPoolTimeseriesData,
    {
      data: poolTimeseriesData,
      loading: poolTimeseriesLoading,
      error: poolTimeseriesError,
      refetch: poolTimeseriesRefetch,
    },
  ] = useLazyQuery(
    gql`
      ${poolTimeseriesQuery}
    `,
    { variables: { poolId }, client },
  );

  const queryPoolOverview = gql`
    ${poolOverview(protocolType, schemaVersion)}
  `;

  const [
    getPoolsOverviewData,
    { data: dataPools, error: poolOverviewError, loading: poolOverviewLoading, refetch: poolOverviewRefetch },
  ] = useLazyQuery(queryPoolOverview, { client: client, variables: { skipAmt } });

  const [getPoolsOverviewData2, { data: dataPools2, error: poolOverviewError2, loading: poolOverviewLoading2 }] =
    useLazyQuery(queryPoolOverview, { client: client, variables: { skipAmt: skipAmt + 10 } });

  const [getPoolsOverviewData3, { data: dataPools3, error: poolOverviewError3, loading: poolOverviewLoading3 }] =
    useLazyQuery(queryPoolOverview, { client: client, variables: { skipAmt: skipAmt + 20 } });

  const [getPoolsOverviewData4, { data: dataPools4, error: poolOverviewError4, loading: poolOverviewLoading4 }] =
    useLazyQuery(queryPoolOverview, { client: client, variables: { skipAmt: skipAmt + 30 } });

  const [getPoolsOverviewData5, { data: dataPools5, error: poolOverviewError5, loading: poolOverviewLoading5 }] =
    useLazyQuery(queryPoolOverview, { client: client, variables: { skipAmt: skipAmt + 40 } });

  const tokenQuery = gql`
    ${poolOverviewTokensQuery(protocolSchemaData?.protocols[0]?.type?.toUpperCase())}
  `;

  const snapshotDailyVolumeQuery = gql`
    ${getSnapshotDailyVolume(schemaVersion)}
  `;

  const [getPoolsSnapshotVolume, { data: snapshotVolume }] = useLazyQuery(snapshotDailyVolumeQuery, { client: client });

  const [getPoolsSnapshotVolume2, { data: snapshotVolume2 }] = useLazyQuery(snapshotDailyVolumeQuery, {
    client: client,
  });

  const [getPoolsSnapshotVolume3, { data: snapshotVolume3 }] = useLazyQuery(snapshotDailyVolumeQuery, {
    client: client,
  });

  const [getPoolsSnapshotVolume4, { data: snapshotVolume4 }] = useLazyQuery(snapshotDailyVolumeQuery, {
    client: client,
  });

  const [getPoolsSnapshotVolume5, { data: snapshotVolume5 }] = useLazyQuery(snapshotDailyVolumeQuery, {
    client: client,
  });

  const [getPoolOverviewTokens, { data: poolOverviewTokens }] = useLazyQuery(tokenQuery, { client: client });

  const [getPoolOverviewTokens2, { data: poolOverviewTokens2 }] = useLazyQuery(tokenQuery, { client: client });

  const [getPoolOverviewTokens3, { data: poolOverviewTokens3 }] = useLazyQuery(tokenQuery, { client: client });

  const [getPoolOverviewTokens4, { data: poolOverviewTokens4 }] = useLazyQuery(tokenQuery, { client: client });

  const [getPoolOverviewTokens5, { data: poolOverviewTokens5 }] = useLazyQuery(tokenQuery, { client: client });

  const [getFailedIndexingStatus, { data: indexingFailureData, error: indexingFailureError }] = useLazyQuery(
    nameQuery,
    { variables: { subgraphName }, client: clientIndexing },
  );

  let tabNum = "1";
  if (tabString.toUpperCase() === "POOLOVERVIEW") {
    tabNum = "2";
  } else if (tabString.toUpperCase() === "POOL") {
    tabNum = "3";
  } else if (tabString.toUpperCase() === "EVENTS") {
    tabNum = "4";
  } else if (tabString.toUpperCase() === "POSITIONS") {
    tabNum = "5";
  }

  const [tabValue, setTabValue] = useState(tabNum);

  const handleTabChange = (event: any, newValue: string) => {
    let tabName = "protocol";
    const href = new URL(window.location.href);
    const p = new URLSearchParams(href.search);
    const poolIdFromParam = p.get("poolId");
    let deploymentVersionParam = "";
    if (!isCurrentVersion) {
      deploymentVersionParam = "&version=pending";
    }
    let nameParam = "";
    if (subgraphName) {
      nameParam = "&name=" + subgraphName;
    }
    let protocolParam = "";
    if (protocolId) {
      protocolParam = `&protocolId=${protocolId}`;
    }
    let skipAmtParam = "";
    let poolParam = "";
    if (newValue === "2") {
      tabName = "poolOverview";
      if (skipAmt > 0) {
        skipAmtParam = `&skipAmt=${skipAmt}`;
      }
    } else if (newValue === "3") {
      poolParam = `&poolId=${poolIdFromParam || poolId}`;
      tabName = "pool";
    } else if (newValue === "4") {
      poolParam = `&poolId=${poolIdFromParam || poolId}`;
      tabName = "events";
    } else if (newValue === "5") {
      poolParam = `&poolId=${poolIdFromParam || poolId}`;
      tabName = "positions";
    }
    navigate(
      `?endpoint=${subgraphParam}&tab=${tabName}${protocolParam}${poolParam}${skipAmtParam}${deploymentVersionParam}`,
    );
    setTabValue(newValue);
  };

  useEffect(() => {
    if (
      pendingVersion?.indexingStatusForPendingVersion?.subgraph &&
      pendingVersion?.indexingStatusForPendingVersion?.health === "healthy"
    ) {
      const pendingURL =
        "https://api.thegraph.com/subgraphs/id/" + pendingVersion?.indexingStatusForPendingVersion?.subgraph;
      if (isCurrentVersion === false) {
        setSubgraphToQuery({ url: pendingURL, version: "pending" });
      }
      setEndpoints({
        current: endpoints.current,
        pending: pendingURL,
      });
    }
  }, [pendingVersion, errorSubId]);

  useEffect(() => {
    // If the schema query request was successful, make the full data query
    if (protocolSchemaData?.protocols?.length > 0) {
      if (protocolIdToUse || protocolSchemaData?.protocols[0]?.id) {
        getData();
        getProtocolTableData();
        getPendingSubgraph();
      }
    }
    getFailedIndexingStatus();
  }, [protocolSchemaData, getData, getProtocolTableData, getPendingSubgraph]);

  useEffect(() => {
    if (protocolTableData && tabValue === "1") {
      getFinancialsData();
    }
  }, [protocolTableData, getFinancialsData, tabValue]);

  useEffect(() => {
    if (financialsData && tabValue === "1") {
      getDailyUsageData();
    }
  }, [financialsData, getDailyUsageData]);

  useEffect(() => {
    if (dailyUsageData && tabValue === "1") {
      getHourlyUsageData();
    }
  }, [dailyUsageData, getHourlyUsageData]);

  useEffect(() => {
    if (poolId) {
      getPoolTimeseriesData();
    }
  }, [poolId]);

  useEffect(() => {
    if (financialsError && tabValue === "1") {
      financialsRefetch();
    }
  }, [financialsError]);

  useEffect(() => {
    if (dailyUsageError && tabValue === "1") {
      dailyUsageRefetch();
    }
  }, [dailyUsageError]);

  useEffect(() => {
    if (hourlyUsageError && tabValue === "1") {
      hourlyUsageRefetch();
    }
  }, [hourlyUsageError]);

  useEffect(() => {
    if (poolsListError) {
      poolsListRefetch();
    }
  }, [poolsListError]);

  useEffect(() => {
    if (poolTimeseriesError) {
      poolTimeseriesRefetch();
    }
  }, [poolTimeseriesError]);

  useEffect(() => {
    if (poolOverviewError) {
      poolOverviewRefetch();
    }
  }, [poolOverviewError]);

  useEffect(() => {
    if (tabValue === "2" && !dataPools) {
      getPoolsOverviewData();
    }
  }, [tabValue, getPoolsOverviewData]);

  useEffect(() => {
    if (data?.protocols && dataPools) {
      const variables: { [x: string]: any } = {};
      for (let idx = 0; idx < 10; idx++) {
        variables["pool" + (idx + 1) + "Id"] = dataPools[PoolNames[data?.protocols[0]?.type]][idx]?.id || "";
      }
      getPoolOverviewTokens({ variables });
      if (data?.protocols[0]?.type === "EXCHANGE") {
        getPoolsSnapshotVolume({ variables });
      }
      if (dataPools[PoolNames[data?.protocols[0]?.type]]?.length === 10 && tabValue === "2" && !dataPools2) {
        getPoolsOverviewData2();
      }
    }
  }, [tabValue, dataPools, poolOverviewLoading]);

  useEffect(() => {
    if (data?.protocols && dataPools2) {
      const variables: { [x: string]: any } = {};
      for (let idx = 0; idx < 10; idx++) {
        variables["pool" + (idx + 1) + "Id"] = dataPools2[PoolNames[data?.protocols[0]?.type]][idx]?.id || "";
      }
      getPoolOverviewTokens2({ variables });
      if (data?.protocols[0]?.type === "EXCHANGE") {
        getPoolsSnapshotVolume2({ variables });
      }
      if (dataPools2[PoolNames[data?.protocols[0]?.type]]?.length === 10 && tabValue === "2" && !dataPools3) {
        getPoolsOverviewData3();
      }
    }
  }, [dataPools2, poolOverviewLoading2]);

  useEffect(() => {
    if (data?.protocols && dataPools3) {
      const variables: { [x: string]: any } = {};
      for (let idx = 0; idx < 10; idx++) {
        variables["pool" + (idx + 1) + "Id"] = dataPools3[PoolNames[data?.protocols[0]?.type]][idx]?.id || "";
      }
      getPoolOverviewTokens3({ variables });
      if (data?.protocols[0]?.type === "EXCHANGE") {
        getPoolsSnapshotVolume3({ variables });
      }
      if (dataPools3[PoolNames[data?.protocols[0]?.type]]?.length === 10 && tabValue === "2" && !dataPools4) {
        getPoolsOverviewData4();
      }
    }
  }, [dataPools3]);

  useEffect(() => {
    if (data?.protocols && dataPools4) {
      const variables: { [x: string]: any } = {};
      for (let idx = 0; idx < 10; idx++) {
        variables["pool" + (idx + 1) + "Id"] = dataPools4[PoolNames[data?.protocols[0]?.type]][idx]?.id || "";
      }
      getPoolOverviewTokens4({ variables });
      if (data?.protocols[0]?.type === "EXCHANGE") {
        getPoolsSnapshotVolume4({ variables });
      }
      if (dataPools4[PoolNames[data?.protocols[0]?.type]]?.length === 10 && tabValue === "2" && !dataPools5) {
        getPoolsOverviewData5();
      }
    }
  }, [dataPools4]);

  useEffect(() => {
    if (data?.protocols && dataPools5) {
      const variables: { [x: string]: any } = {};
      for (let idx = 0; idx < 10; idx++) {
        variables["pool" + (idx + 1) + "Id"] = dataPools5[PoolNames[data?.protocols[0]?.type]][idx]?.id || "";
      }
      getPoolOverviewTokens5({ variables });
      if (data?.protocols[0]?.type === "EXCHANGE") {
        getPoolsSnapshotVolume5({ variables });
      }
    }
  }, [dataPools5]);

  useEffect(() => {
    if (tabValue === "3" || tabValue === "4" || tabValue === "5") {
      getPoolsListData();
    }
  }, [tabValue, getPoolsListData]);

  useEffect(() => {
    document.getElementById(scrollToView)?.scrollIntoView();
  });

  // Error logging in case the full data request throws an error
  useEffect(() => {
    if (error || protocolSchemaQueryError) {
      console.log("--------------------Error Start-------------------------");
      console.log(error, protocolSchemaQueryError);
      console.log("--------------------Error End---------------------------");
    }
  }, [error, protocolSchemaQueryError]);

  // errorRender is the element to be rendered to display the error
  let errorDisplayProps = null;
  // Conditionals for calling the errorDisplay() function for the various types of errors

  if (protocolSchemaQueryError && !protocolSchemaQueryLoading) {
    // ...includes('has no field') checks if the error is describing a discrepancy between the protocol query and the fields in the protocol entity on the schema
    if (!protocolSchemaData && !protocolSchemaQueryError.message.includes("has no field")) {
      errorDisplayProps = new ApolloError({
        errorMessage: `DEPLOYMENT UNREACHABLE - ${subgraphToQuery.url} is not a valid subgraph endpoint URL. If a subgraph namestring was used, make sure that the namestring points to a hosted service deployment named using the standard naming convention (for example 'messari/uniswap-v3-ethereum').`,
      });
    } else {
      errorDisplayProps = protocolSchemaQueryError;
    }
  }
  if (error && !loading) {
    errorDisplayProps = error;
  }

  let tokenKey = "inputTokens";
  if (
    protocolSchemaData?.protocols[0]?.type === ProtocolType.LENDING ||
    protocolSchemaData?.protocols[0]?.type === ProtocolType.YIELD
  ) {
    tokenKey = "inputToken";
  }
  let pools: { [x: string]: any }[] = [];
  if (dataPools && data) {
    let poolArray = dataPools[PoolNames[data?.protocols[0]?.type]];
    if (snapshotVolume) {
      if (Object.keys(snapshotVolume)?.length > 0) {
        const copyPool = [...poolArray];
        poolArray = [];
        Object.keys(snapshotVolume).forEach((x, idx) => {
          const copyElement = { ...copyPool[idx] };
          copyElement.dailySupplySideRevenueUSD =
            snapshotVolume[x][snapshotVolume[x].length - 1]?.dailySupplySideRevenueUSD;
          copyElement.dailyVolumeUSD = snapshotVolume[x][snapshotVolume[x].length - 1]?.dailyVolumeUSD;

          poolArray.push(copyElement);
        });
      }
    }
    if (poolOverviewTokens) {
      if (Object.keys(poolOverviewTokens)?.length > 0) {
        const copyPool = [...poolArray];
        poolArray = [];
        Object.keys(poolOverviewTokens).forEach((x, idx) => {
          if (poolOverviewTokens[x]) {
            const copyElement = { ...copyPool[idx] };
            copyElement[tokenKey] = poolOverviewTokens[x][tokenKey];
            copyElement["rewardTokens"] = poolOverviewTokens[x]["rewardTokens"];
            poolArray.push(copyElement);
          }
        });
      }
    }
    pools = poolArray;
  }
  if (dataPools2 && data) {
    let poolArray = dataPools2[PoolNames[data?.protocols[0]?.type]];
    if (snapshotVolume2) {
      if (Object.keys(snapshotVolume2)?.length > 0) {
        const copyPool = [...poolArray];
        poolArray = [];
        Object.keys(snapshotVolume2).forEach((x, idx) => {
          const copyElement = { ...copyPool[idx] };
          copyElement.dailySupplySideRevenueUSD =
            snapshotVolume2[x][snapshotVolume2[x].length - 1]?.dailySupplySideRevenueUSD;
          copyElement.dailyVolumeUSD = snapshotVolume2[x][snapshotVolume2[x].length - 1]?.dailyVolumeUSD;

          poolArray.push(copyElement);
        });
      }
    }
    if (poolOverviewTokens2) {
      if (Object.keys(poolOverviewTokens2).length > 0) {
        const copyPool = [...poolArray];
        poolArray = [];
        Object.keys(poolOverviewTokens2).forEach((x, idx) => {
          if (poolOverviewTokens2[x]) {
            const copyElement = { ...copyPool[idx] };
            copyElement[tokenKey] = poolOverviewTokens2[x][tokenKey];
            copyElement["rewardTokens"] = poolOverviewTokens2[x]["rewardTokens"];
            poolArray.push(copyElement);
          }
        });
      }
    }
    pools = pools.concat(poolArray);
  }
  if (dataPools3 && data) {
    let poolArray = dataPools3[PoolNames[data?.protocols[0]?.type]];
    if (snapshotVolume3) {
      if (Object.keys(snapshotVolume3)?.length > 0) {
        const copyPool = [...poolArray];
        poolArray = [];
        Object.keys(snapshotVolume3).forEach((x, idx) => {
          const copyElement = { ...copyPool[idx] };
          copyElement.dailySupplySideRevenueUSD =
            snapshotVolume3[x][snapshotVolume3[x].length - 1]?.dailySupplySideRevenueUSD;
          copyElement.dailyVolumeUSD = snapshotVolume3[x][snapshotVolume3[x].length - 1]?.dailyVolumeUSD;

          poolArray.push(copyElement);
        });
      }
    }
    if (poolOverviewTokens3) {
      if (Object.keys(poolOverviewTokens3).length > 0) {
        const copyPool = [...poolArray];
        poolArray = [];
        Object.keys(poolOverviewTokens3).forEach((x, idx) => {
          if (poolOverviewTokens3[x]) {
            const copyElement = { ...copyPool[idx] };
            copyElement[tokenKey] = poolOverviewTokens3[x][tokenKey];
            copyElement["rewardTokens"] = poolOverviewTokens3[x]["rewardTokens"];
            poolArray.push(copyElement);
          }
        });
      }
    }
    pools = pools.concat(poolArray);
  }
  if (dataPools4 && data) {
    let poolArray = dataPools4[PoolNames[data?.protocols[0]?.type]];
    if (snapshotVolume4) {
      if (Object.keys(snapshotVolume4)?.length > 0) {
        const copyPool = [...poolArray];
        poolArray = [];
        Object.keys(snapshotVolume4).forEach((x, idx) => {
          const copyElement = { ...copyPool[idx] };
          copyElement.dailySupplySideRevenueUSD =
            snapshotVolume4[x][snapshotVolume4[x].length - 1]?.dailySupplySideRevenueUSD;
          copyElement.dailyVolumeUSD = snapshotVolume4[x][snapshotVolume4[x].length - 1]?.dailyVolumeUSD;

          poolArray.push(copyElement);
        });
      }
    }
    if (poolOverviewTokens4) {
      if (Object.keys(poolOverviewTokens4).length > 0) {
        const copyPool = [...poolArray];
        poolArray = [];
        Object.keys(poolOverviewTokens4).forEach((x, idx) => {
          if (poolOverviewTokens4[x]) {
            const copyElement = { ...copyPool[idx] };
            copyElement[tokenKey] = poolOverviewTokens4[x][tokenKey];
            copyElement["rewardTokens"] = poolOverviewTokens4[x]["rewardTokens"];
            poolArray.push(copyElement);
          }
        });
      }
    }
    pools = pools.concat(poolArray);
  }
  if (dataPools5 && data) {
    let poolArray = dataPools5[PoolNames[data?.protocols[0]?.type]];
    if (snapshotVolume5) {
      if (Object.keys(snapshotVolume5)?.length > 0) {
        const copyPool = [...poolArray];
        poolArray = [];
        Object.keys(snapshotVolume5).forEach((x, idx) => {
          const copyElement = { ...copyPool[idx] };
          copyElement.dailySupplySideRevenueUSD =
            snapshotVolume5[x][snapshotVolume5[x].length - 1]?.dailySupplySideRevenueUSD;
          copyElement.dailyVolumeUSD = snapshotVolume5[x][snapshotVolume5[x].length - 1]?.dailyVolumeUSD;

          poolArray.push(copyElement);
        });
      }
    }
    if (poolOverviewTokens5) {
      if (Object.keys(poolOverviewTokens5).length > 0) {
        const copyPool = [...poolArray];
        poolArray = [];
        Object.keys(poolOverviewTokens5).forEach((x, idx) => {
          if (poolOverviewTokens5[x]) {
            const copyElement = { ...copyPool[idx] };
            copyElement[tokenKey] = poolOverviewTokens5[x][tokenKey];
            copyElement["rewardTokens"] = poolOverviewTokens5[x]["rewardTokens"];
            poolArray.push(copyElement);
          }
        });
      }
    }
    pools = pools.concat(poolArray);
  }

  if (pools?.length > 0) {
    let poolTemp = [...pools];
    pools = poolTemp.sort((a, b) => {
      return b.totalValueLockedUSD - a.totalValueLockedUSD;
    });
  }

  let anyPoolOverviewLoading = false;
  if (
    poolOverviewLoading ||
    poolOverviewLoading2 ||
    poolOverviewLoading3 ||
    poolOverviewLoading4 ||
    poolOverviewLoading5
  ) {
    anyPoolOverviewLoading = true;
  }

  let anyPoolOverviewError = null;
  if (poolOverviewError5) {
    anyPoolOverviewError = poolOverviewError5;
  }
  if (poolOverviewError4) {
    anyPoolOverviewError = poolOverviewError4;
  }
  if (poolOverviewError3) {
    anyPoolOverviewError = poolOverviewError3;
  }
  if (poolOverviewError2) {
    anyPoolOverviewError = poolOverviewError2;
  }
  if (poolOverviewError) {
    anyPoolOverviewError = poolOverviewError;
  }

  let toggleVersion = null;

  if (endpoints?.pending) {
    let pendingStyle: { [x: string]: any } = {
      color: "#20252c",
      backgroundColor: "white",
      padding: "8px 10px",
      borderRadius: "25px",
      margin: "4px 6px",
    };
    let currentStyle: { [x: string]: any } = {};
    if (isCurrentVersion) {
      pendingStyle = {};
      currentStyle = {
        color: "#20252c",
        backgroundColor: "white",
        padding: "8px 10px",
        borderRadius: "25px",
        margin: "4px 6px",
      };
    }
    let currentToggle = null;
    if (endpoints?.current) {
      currentToggle = (
        <span
          style={currentStyle}
          onClick={() => {
            const href = new URL(window.location.href);
            const p = new URLSearchParams(href.search);
            p.set("version", "current");
            p.set("endpoint", endpoints?.current);
            p.set("name", subgraphName);
            p.delete("view");
            p.delete("poolId");
            p.delete("protocolId");
            navigate("?" + p.toString().split("%2F").join("/"));
            setSubgraphToQuery({ url: endpoints?.current, version: "" });
            setIsCurrentVersion(true);
          }}
        >
          CURRENT VERSION
        </span>
      );
    }
    let pendingToggle = null;
    if (endpoints?.pending) {
      pendingToggle = (
        <span
          style={pendingStyle}
          onClick={() => {
            const href = new URL(window.location.href);
            const p = new URLSearchParams(href.search);
            p.set("version", "pending");
            p.set("endpoint", endpoints?.pending);
            p.set("name", subgraphName);
            p.delete("view");
            p.delete("poolId");
            p.delete("protocolId");
            navigate("?" + p.toString().split("%2F").join("/"));
            setSubgraphToQuery({ url: endpoints?.pending, version: "" });
            setIsCurrentVersion(false);
          }}
        >
          PENDING VERSION
        </span>
      );
    }
    toggleVersion = (
      <BackBanner>
        {currentToggle}
        {pendingToggle}
      </BackBanner>
    );
  }

  let protocolSchemaDataProp = protocolSchemaData;
  const brokenDownName = subgraphName.split("/")[1]?.split("-");
  const network = brokenDownName?.pop() || "";
  if (!protocolSchemaDataProp?.protocols[0]) {
    protocolSchemaDataProp = {
      protocols: [
        {
          type: "N/A",
          name: brokenDownName ? brokenDownName?.join(" ") : "",
          network: network.toUpperCase(),
          schemaVersion: "N/A",
          subgraphVersion: "N/A",
        },
      ],
    };
  }

  const indexingStatusKey = "indexingStatusFor" + (isCurrentVersion ? "CurrentVersion" : "PendingVersion");
  if (!errorDisplayProps && indexingFailureData) {
    const errMsg = indexingFailureData[indexingStatusKey]?.fatalError?.message;
    if (typeof errMsg === "string") {
      errorDisplayProps = new ApolloError({
        errorMessage: `SUBGRAPH DATA UNREACHABLE - ${subgraphToQuery.url}. INDEXING ERROR - "${errMsg}".`,
      });
    }
  }

  if (data) {
    errorDisplayProps = null;
  }

  return (
    <div className="ProtocolDashboard">
      <DashboardHeader
        protocolData={protocolSchemaDataProp}
        protocolId={protocolId}
        subgraphToQueryURL={subgraphToQuery.url}
        schemaVersion={schemaVersion}
      />
      {toggleVersion}
      {(protocolSchemaQueryLoading || loading) && !!subgraphToQuery.url ? (
        <CircularProgress sx={{ margin: 6 }} size={50} />
      ) : null}
      <ErrorDisplay
        errorObject={errorDisplayProps}
        protocolData={data}
        subgraphToQuery={subgraphToQuery}
        setSubgraphToQuery={(x) => setSubgraphToQuery(x)}
      />
      {!!data && (
        <AllDataTabs
          data={data}
          entitiesData={entitiesData}
          tabValue={tabValue}
          events={events}
          pools={pools}
          poolsListData={poolsListData}
          poolListLoading={poolListLoading}
          poolsListError={poolsListError}
          poolNames={PoolNames[data.protocols[0].type]}
          poolId={poolId}
          poolData={poolData}
          protocolFields={protocolFields}
          protocolTableData={protocolTableData}
          subgraphToQueryURL={subgraphToQuery.url}
          skipAmt={skipAmt}
          poolOverviewRequest={{ poolOverviewError: anyPoolOverviewError, poolOverviewLoading: anyPoolOverviewLoading }}
          poolTimeseriesRequest={{ poolTimeseriesData, poolTimeseriesError, poolTimeseriesLoading }}
          positionsQuery={positionsQuery}
          protocolTimeseriesData={{
            financialsDailySnapshots: financialsData?.financialsDailySnapshots,
            usageMetricsDailySnapshots: dailyUsageData?.usageMetricsDailySnapshots,
            usageMetricsHourlySnapshots: hourlyUsageData?.usageMetricsHourlySnapshots,
          }}
          protocolTimeseriesLoading={{
            financialsDailySnapshots: financialsLoading,
            usageMetricsDailySnapshots: dailyUsageLoading,
            usageMetricsHourlySnapshots: hourlyUsageLoading,
          }}
          protocolTimeseriesError={{
            financialsDailySnapshots: financialsError,
            usageMetricsDailySnapshots: dailyUsageError,
            usageMetricsHourlySnapshots: hourlyUsageError,
          }}
          setPoolId={(x) => setPoolId(x)}
          handleTabChange={(x, y) => handleTabChange(x, y)}
          setProtocolId={(x) => setprotocolId(x)}
          paginate={(x) => paginate(x)}
        />
      )}
    </div>
  );
}

export default ProtocolDashboard;
