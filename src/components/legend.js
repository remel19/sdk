/*
 * Copyright 2015-present Boundless Spatial Inc., http://boundlessgeo.com
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and limitations
 * under the License.
 */

import fetch from 'isomorphic-fetch';
import PropTypes from 'prop-types';
import React from 'react';
import { connect } from 'react-redux';
import OlRender from 'ol/render';
import LineString from 'ol/geom/linestring';
import Polygon from 'ol/geom/polygon';
import Point from 'ol/geom/point';
import Feature from 'ol/feature';
import VectorLayer from 'ol/layer/vector';
import { applyStyle } from 'ol-mapbox-style';
import { jsonClone, getLayerById, parseQueryString, encodeQueryObject } from '../util';
import { getFakeStyle, hydrateLayer } from './map';

/** @module components/legend
 * @desc React Component to render the legend data.
 * Create legend objects using the metadata prefixes
 *  "bnd:legend-type" and "bnd:legend-contents".
 *  Neither the Mapbox GL Spec nor the specific underlying
 *  services for vector layers have a standardized way of
 *  providing legends.  This is using the metadata provided
 *  by the layer to do so.
 *  "bnd:legend-type" can be one of "image", "html", "href"
 *  where "bnd:legend-content" would then provide the appropriate
 *  additional information.
 *  "bnd:legend-type" : "image", "bnd:legend-content" would provide
 *   the src attribute for an <img>
 *  "bnd:legend-type" : "html", "bnd:legend-content" would provide
 *   the html content for a <div>
 *  "bnd:legend-type" : "href", "bnd:legend-content" would provide
 *   the URL for html content.
 */

/** Return a div that is asynchronously populated
 *  with the content from the parameter href.
 *
 *  @param {string} href The location of the content for the div.
 *
 *  @returns {Object} A <div> element.
 */
function getRemoteLegend(href) {
  let ref = null;
  const div = (<div ref={(me) => { ref = me; }} />);

  // kick off the href fun!
  fetch(href).then(response => response.text())
  .then((html) => {
    // This is equivalent to dangerouslySetInnerHTML
    if (ref !== null) {
      ref.innerHTML = html;
    }
  });

  return div;
}

/** 
 *   @param {Object} layer Mapbox GL layer.
 *
 *   @returns {(Object|null)} A <div> or <img> element, or null.
 */
export function getLegend(layer) {
  if (layer.metadata === undefined) {
    return null;
  }
  const content = layer.metadata['bnd:legend-content'];

  switch (layer.metadata['bnd:legend-type']) {
    case 'image':
      return (<img alt={layer.id} src={content} />);
    case 'html':
      // eslint-disable-next-line
      return (<div dangerouslySetInnerHTML={{ __html: content }} />);
    case 'href':
      return getRemoteLegend(content);
    default:
      // no legend provided.
      return null;
  }
}

const vectorCache = {};
const canvasCache = {};
const olLayer = new VectorLayer();

const pointGeomCache = {};
export function getPointGeometry(size) {
  if (!pointGeomCache[size]) {
    pointGeomCache[size] = new Point([size[0] / 2, size[1] / 2]);
  }
  return pointGeomCache[size];
}

const lineGeomCache = {};
export function getLineGeometry(size) {
  if (!lineGeomCache[size]) {
    const center = [size[0] / 2, size[1] / 2];
    lineGeomCache[size] = new LineString([
      [-8 + center[0], -3 + center[1]],
      [-3 + center[0] , 3 + center[1]],
      [3 + center[0], -3 + center[1]],
      [8 + center[0], 3 + center[1]]
    ]);
  }
  return lineGeomCache[size];
}

const polygonGeomCache = {};
export function getPolygonGeometry(size) {
  if (!polygonGeomCache[size]) {
    const center = [size[0] / 2, size[1] / 2];
    polygonGeomCache[size] = new Polygon([[
      [-8 + center[0], -4 + center[1]],
      [-6 + center[0], -6 + center[1]],
      [6 + center[0], -6 + center[1]],
      [8 + center[0], -4 + center[1]],
      [8 + center[0], 4 + center[1]],
      [6 + center[0], 6 + center[1]],
      [-6 + center[0], 6 + center[1]],
      [-8 + center[0], 4 + center[1]]
    ]]);
  }
  return polygonGeomCache[size];
}

export function getVectorLegend(layer, layer_src, props) {
  if (!layer.metadata || !layer.metadata['bnd:legend-type']) {
    const size = props.size;
    return (<canvas ref={(c) => {
      if (c !== null) {
        let vectorContext;
        if (!vectorCache[layer.id]) {
          canvasCache[layer.id] = c;
          vectorContext = OlRender.toContext(c.getContext('2d'), {size: size});
          vectorCache[layer.id] = vectorContext;
        } else {
          vectorContext = vectorCache[layer.id];
          const canvas = canvasCache[layer.id];
          canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        }
        let newLayer;
        if (layer.filter) {
          newLayer = jsonClone(layer);
          delete newLayer.filter;
        } else {
          newLayer = layer;
        }
        const fake_style = getFakeStyle(
          props.sprite,
          [newLayer],
          props.mapbox.baseUrl,
          props.mapbox.accessToken
        );

        applyStyle(olLayer, fake_style, layer.source).then(function() {
          const styleFn = olLayer.getStyle();
          let geom;
          if (layer.type === 'symbol' || layer.type === 'circle') {
            geom = getPointGeometry(size);
          } else if (layer.type === 'line') {
            geom = getLineGeometry(size);
          } else if (layer.type === 'fill') {
            geom = getPolygonGeometry(size);
          }
          if (geom) {
            const properties = {};
            if (layer['source-layer']) {
              properties.layer = layer['source-layer'];
            }
            const feature = new Feature(properties);
            feature.setGeometry(geom);
            const styles = styleFn(feature);
            if (styles && styles.length > 0) {
              vectorContext.setStyle(styles[0]);
              vectorContext.drawGeometry(geom);
            }
          }
        });
      }
    }} />);
  } else {
    return getLegend(layer, layer_src);
  }
}

/** Get the legend for a raster-type layer.
 *  Attempts to detect a WMS-type source and use GetLegendGraphic,
 *  otherwise, uses SDK specified legend metadata.
 *
 *  @param {Object} layer Mapbox GL layer object.
 *  @param {Object} layer_src Mapbox GL source object.
 *
 *  @returns {(Object[]|Object)} An array of <img> elements or a <div> element.
 */
export function getRasterLegend(layer, layer_src) {
  if (layer_src.tiles && layer_src.tiles.length > 0) {
    const tile_url = layer_src.tiles[0];
    // check to see if the url is a wms request.
    if (tile_url.toUpperCase().indexOf('SERVICE=WMS') >= 0) {
      const tile_url_parts = tile_url.split('?');
      // parse the url
      const wms_params = parseQueryString(tile_url_parts[1]);

      // normalize the keys: WMS requests are sometimes allcaps,
      //  sometimes lower cased, and sometimes (evilly so) mixed case.
      const wms_keys = Object.keys(wms_params);
      for (let i = 0, ii = wms_keys.length; i < ii; i++) {
        const key = wms_keys[i];
        const uc_key = key.toUpperCase();
        wms_params[uc_key] = wms_params[key];
      }

      // get the WMS servers URL.
      const url = tile_url_parts[0];

      // REQUEST, FORMAT, and LAYER are the three required GetLegendGraphic
      // parameters.  LAYER is populated after the optional keys are added.
      const legend_params = {
        SERVICE: 'WMS',
        REQUEST: 'GetLegendGraphic',
        FORMAT: wms_params.FORMAT,
      };

      // These are optional parameters and will not be found in
      // every WMS request. This checks for the parameter before
      // adding it in.
      // WIDTH and HEIGHT are omitted as they provide a
      // hint for the LEGEND size not the underlaying map size.
      const optional_keys = [
        'STYLE', 'FEATURETYPE', 'RULE', 'SCALE',
        'SLD', 'SLD_BODY',
        'EXCEPTIONS', 'LANGUAGE',
      ];

      for (let i = 0, ii = optional_keys.length; i < ii; i++) {
        const value = wms_params[optional_keys[i]];
        if (value !== undefined) {
          legend_params[optional_keys[i]] = value;
        }
      }

      // Build the stack of URLs for each layer. Unlike GetMap,
      // each layer needs a separate call.
      const images = [];
      const layers = wms_params.LAYERS.split(',');
      for (let i = 0, ii = layers.length; i < ii; i++) {
        const params = Object.assign({}, legend_params, {
          LAYER: layers[i],
        });
        const src = `${url}?${encodeQueryObject(params)}`;
        images.push((<img alt={layers[i]} key={layers[i]} className="sdk-legend-image" src={src} />));
      }

      return images;
    }
  }

  return getLegend(layer);
}


class Legend extends React.Component {

  componentWillReceiveProps(nextProps) {
    const nextLayer = getLayerById(nextProps.layers, this.props.layerId);
    const layer = getLayerById(this.props.layers, this.props.layerId);
    return (layer !== nextLayer);
  }

  /** Handles how to get the legend data based on the layer source type.
   *  @returns {Object} Call to getRasterLegend() or getLegend() to return the html element.
   */
  getLegendContents() {
    // get the layer definition
    const layer = getLayerById(this.props.layers, this.props.layerId);
    if (layer === null) {
      return null;
    }

    let source_name = layer.source;
    if (layer.ref && !layer.source) {
      const ref_layer = getLayerById(this.props.layers, layer.ref);
      source_name = ref_layer.source;
    }
    const layer_src = this.props.sources[source_name];

    switch (layer_src.type) {
      case 'raster':
        return getRasterLegend(layer, layer_src);
      // while this may seem pretty verbose,
      //  it was intentionally left here to make it
      //  easy to implement other legend handlers as
      //  is deemed appropriate.
      case 'vector':
      case 'geojson':
        let legendLayer;
        if (layer.ref) {
          legendLayer = hydrateLayer(this.props.layers, layer);
        } else {
          legendLayer = layer;
        }
        return getVectorLegend(legendLayer, layer_src, this.props);
      case 'image':
      case 'video':
      case 'canvas':
      default:
        return getLegend(layer, layer_src);
    }
  }

  render() {
    let legend_contents = this.getLegendContents();
    if (legend_contents === null) {
      legend_contents = this.props.emptyLegendMessage;
    }
    let className = 'sdk-legend';
    if (this.props.className) {
      className = `${className} ${this.props.className}`;
    }

    return (
      <div style={this.props.style} className={className}>
        { legend_contents }
      </div>
    );
  }
}

Legend.propTypes = {
  layerId: PropTypes.string.isRequired,
  layers: PropTypes.arrayOf(PropTypes.object),
  sources: PropTypes.shape({
    source: PropTypes.string,
  }),
  mapbox: PropTypes.shape({
    baseUrl: PropTypes.string,
    accessToken: PropTypes.string,
  }),
  sprite: PropTypes.string,
  emptyLegendMessage: PropTypes.string,
  size: PropTypes.arrayOf(PropTypes.number),
  style: PropTypes.object,
  className: PropTypes.string,
};

Legend.defaultProps = {
  size: [50, 50],
  mapbox: {
    baseUrl: '',
    accessToken: '',
  },
  layers: [],
  sources: {},
  emptyLegendMessage: undefined,
};

function mapStateToProps(state) {
  return {
    sprite: state.map.sprite,
    layers: state.map.layers,
    sources: state.map.sources,
    mapbox: state.mapbox,
  };
}

export default connect(mapStateToProps, undefined, undefined, {withRef: true})(Legend);
